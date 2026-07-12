import { dataUrlToUploadPart, decodeBase64AudioInput } from './mediaPayload.js';
import { getResponseErrorMessage, parseUpstreamErrorMessage, isRateLimitErrorMessage } from './upstreamErrors.js';

export function registerAiRoutes(app, deps) {
  const {
    upstreamFetch,
    resolveAiOwnerFromInput,
    getAiSessions,
    createAiSession,
    findAiSession,
    upsertAiSession,
    appendAiMessage,
    getAiTask,
    registerAiTask,
    serializeAiTask,
    runAiTask,
    videoJobStore,
    removeAiSession,
    removeAllAiSessions,
    generateEntityId,
    normalizeChatModel,
    resolveChatProvider,
    resolveImageProvider,
    buildResponsesInput,
    buildResponsesInstructions,
    buildChatCompletionsMessages,
    buildChatCompletionsPayload,
    streamResponse,
    appendOptionalImageSize,
    buildCompatibleImagePrompt,
    resolveGeneratedImages,
    DEFAULT_CHAT_API_KEY,
    DEFAULT_CHAT_MODEL,
    DEFAULT_ENABLE_WEB_SEARCH,
    isKittyVoiceModel,
    VOICE_STREAMING_TEXT,
    DEFAULT_IMAGE_API_URL,
    DEFAULT_IMAGE_API_KEY,
    DEFAULT_IMAGE_MODEL,
    VIDEO_API_MODEL,
    BAIDU_SPEECH_API_KEY,
    BAIDU_SPEECH_SECRET_KEY,
    BAIDU_SPEECH_TOKEN_URL,
    BAIDU_SPEECH_ASR_URL,
    BAIDU_SPEECH_DEV_PID,
  } = deps;

  const baiduSpeechTokenCache = {
    accessToken: '',
    expiresAt: 0,
  };
  const videoImageDataUrlPattern = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/i;
  const videoReferenceMaxBytes = 10 * 1024 * 1024;

  function validateVideoReferenceImages(input) {
    if (!Array.isArray(input)) {
      throw new Error('参考图必须是数组');
    }
    if (input.length > 2) {
      throw new Error('最多上传 2 张参考图');
    }

    return input.map((item) => {
      const source = String(item || '').trim();
      const match = source.match(videoImageDataUrlPattern);
      if (!match) {
        throw new Error('参考图只支持 PNG、JPEG 或 WebP data URL');
      }
      const buffer = Buffer.from(match[2], 'base64');
      if (!buffer.length) {
        throw new Error('参考图内容为空');
      }
      if (buffer.length > videoReferenceMaxBytes) {
        throw new Error('单张参考图不能超过 10 MB');
      }
      return source;
    });
  }

  function resolveOrCreateVideoSession(ownerLookup, requestedSessionId) {
    let session = findAiSession(ownerLookup.ownerRef, requestedSessionId);
    if (!session) {
      session = createAiSession(ownerLookup.ownerRef, {
        model: VIDEO_API_MODEL,
        ownerId: ownerLookup.ownerId,
        ownerType: ownerLookup.ownerType,
      });
    } else if (session.model !== VIDEO_API_MODEL) {
      session.model = VIDEO_API_MODEL;
      upsertAiSession(ownerLookup.ownerRef, session);
    }
    return session;
  }

  function setSessionPendingTask(ownerRef, sessionId, taskId) {
    const session = findAiSession(ownerRef, sessionId);
    if (!session) {
      throw new Error('AI 会话不存在');
    }
    session.pendingTaskId = taskId;
    upsertAiSession(ownerRef, session);
  }

  function getOwnedTask(req) {
    const ownerLookup = resolveAiOwnerFromInput(req.query, { requireKnownUser: true });
    if (ownerLookup.error) {
      return null;
    }
    const task = getAiTask(req.params.taskId);
    if (!task || task.ownerId !== ownerLookup.ownerId || task.ownerType !== ownerLookup.ownerType) {
      return null;
    }
    return task;
  }

  async function getBaiduSpeechAccessToken() {
    const now = Date.now();
    if (baiduSpeechTokenCache.accessToken && baiduSpeechTokenCache.expiresAt - now > 60_000) {
      return baiduSpeechTokenCache.accessToken;
    }

    const params = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: BAIDU_SPEECH_API_KEY,
      client_secret: BAIDU_SPEECH_SECRET_KEY,
    });

    const response = await upstreamFetch(`${BAIDU_SPEECH_TOKEN_URL}?${params.toString()}`, {
      method: 'POST',
    });

    if (!response.ok) {
      throw new Error(await getResponseErrorMessage(response, '获取百度语音 Token 失败'));
    }

    const result = await response.json();
    const accessToken = String(result?.access_token || '').trim();
    const expiresIn = Number(result?.expires_in || 0);
    if (!accessToken) {
      throw new Error('百度语音 Token 返回为空');
    }

    baiduSpeechTokenCache.accessToken = accessToken;
    baiduSpeechTokenCache.expiresAt = now + Math.max(60_000, expiresIn * 1000);
    return accessToken;
  }

  async function transcribeAudioWithBaidu({ audioBuffer, cuid = 'chatkitty-server' }) {
    const accessToken = await getBaiduSpeechAccessToken();

    const response = await upstreamFetch(BAIDU_SPEECH_ASR_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        format: 'wav',
        rate: 16000,
        channel: 1,
        cuid,
        token: accessToken,
        dev_pid: BAIDU_SPEECH_DEV_PID,
        speech: audioBuffer.toString('base64'),
        len: audioBuffer.length,
      }),
    });

    if (!response.ok) {
      throw new Error(await getResponseErrorMessage(response, '百度语音识别请求失败'));
    }

    const result = await response.json();
    if (Number(result?.err_no || 0) !== 0) {
      throw new Error(String(result?.err_msg || '百度语音识别失败'));
    }

    const transcript = Array.isArray(result?.result)
      ? result.result.map(item => String(item || '').trim()).filter(Boolean).join(' ')
      : '';

    if (!transcript) {
      throw new Error('百度语音识别结果为空');
    }

    return transcript;
  }

  app.get('/api/ai-sessions/:userId', (req, res) => {
    const ownerLookup = String(req.query.ownerType || '').trim() === 'guest'
      ? resolveAiOwnerFromInput({ guestId: req.params.userId }, { requireKnownUser: false })
      : resolveAiOwnerFromInput({ userId: req.params.userId });

    if (ownerLookup.error) {
      return res.status(String(req.query.ownerType || '').trim() === 'guest' ? 400 : 404).json({ error: ownerLookup.error });
    }

    res.json({
      sessions: getAiSessions(ownerLookup.ownerRef),
    });
  });

  app.post('/api/ai-sessions', (req, res) => {
    const ownerLookup = resolveAiOwnerFromInput(req.body, { requireKnownUser: true });
    const model = req.body.model ? String(req.body.model) : undefined;

    if (ownerLookup.error) {
      return res.status(req.body.guestId ? 400 : 404).json({ error: ownerLookup.error });
    }

    const session = createAiSession(ownerLookup.ownerRef, {
      model,
      ownerId: ownerLookup.ownerId,
      ownerType: ownerLookup.ownerType,
    });
    res.json({ session });
  });

  app.delete('/api/ai-sessions/:userId', (req, res) => {
    const ownerLookup = String(req.query.ownerType || '').trim() === 'guest'
      ? resolveAiOwnerFromInput({ guestId: req.params.userId }, { requireKnownUser: false })
      : resolveAiOwnerFromInput({ userId: req.params.userId });

    if (ownerLookup.error) {
      return res.status(req.query.ownerType === 'guest' ? 400 : 404).json({ error: ownerLookup.error });
    }

    const deletedCount = removeAllAiSessions(ownerLookup.ownerRef);

    res.json({ success: true, deletedCount });
  });

    app.delete('/api/ai-sessions/:userId/:sessionId', (req, res) => {
    const ownerLookup = String(req.query.ownerType || '').trim() === 'guest'
      ? resolveAiOwnerFromInput({ guestId: req.params.userId }, { requireKnownUser: false })
      : resolveAiOwnerFromInput({ userId: req.params.userId });
    const sessionId = String(req.params.sessionId || '').trim();

    if (ownerLookup.error) {
      return res.status(req.query.ownerType === 'guest' ? 400 : 404).json({ error: ownerLookup.error });
    }

    removeAiSession(ownerLookup.ownerRef, sessionId);

    res.json({ success: true });
  });

  app.post('/api/voice/transcribe', async (req, res) => {
    try {
      const audioData = String(req.body.audioData || '').trim();
      const mimeType = String(req.body.mimeType || 'audio/webm').trim() || 'audio/webm';

      if (!audioData) {
        return res.status(400).json({ error: '音频内容不能为空' });
      }

      const { buffer } = decodeBase64AudioInput(audioData, mimeType);
      const transcript = await transcribeAudioWithBaidu({
        audioBuffer: buffer,
        cuid: `chatkitty-${String(req.ip || 'unknown').replace(/[^\w.-]/g, '_')}`,
      });

      return res.json({ text: transcript });
    } catch (error) {
      console.error('Failed to transcribe audio', error);
      return res.status(500).json({
        error: error instanceof Error ? error.message : '语音转文字失败',
      });
    }
  });

  app.post('/api/ai-task/chat', (req, res) => {
    const ownerLookup = resolveAiOwnerFromInput(req.body, { requireKnownUser: true });

    if (ownerLookup.error) {
      return res.status(req.body.guestId ? 400 : 404).json({ error: ownerLookup.error });
    }

    const content = String(req.body.content || '').trim();
    const images = Array.isArray(req.body.images) ? req.body.images.filter(item => typeof item === 'string' && item.trim()) : [];
    const files = Array.isArray(req.body.files) ? req.body.files : [];

    if (!content && !images.length && !files.length) {
      return res.status(400).json({ error: '消息内容不能为空' });
    }

    const model = normalizeChatModel(req.body.model || DEFAULT_CHAT_MODEL);
    let session = findAiSession(ownerLookup.ownerRef, req.body.sessionId);
    if (!session) {
      session = createAiSession(ownerLookup.ownerRef, {
        model,
        ownerId: ownerLookup.ownerId,
        ownerType: ownerLookup.ownerType,
      });
    } else if (session.model !== model) {
      session.model = model;
      upsertAiSession(ownerLookup.ownerRef, session);
    }

    const userMessage = appendAiMessage(ownerLookup.ownerRef, session.id, {
      role: 'user',
      content,
      images: images.length ? images : undefined,
      files: files.length ? files : undefined,
      status: 'sent',
    });

    const isVoiceMode = isKittyVoiceModel(model);
    const assistantMessage = appendAiMessage(ownerLookup.ownerRef, session.id, {
      role: 'assistant',
      content: isVoiceMode ? VOICE_STREAMING_TEXT : '正在思考...',
      status: 'streaming',
    });

    const task = {
      id: generateEntityId('ai_task'),
      userId: ownerLookup.ownerType === 'user' ? ownerLookup.ownerId : '',
      ownerId: ownerLookup.ownerId,
      ownerType: ownerLookup.ownerType,
      sessionId: session.id,
      messageId: assistantMessage.id,
      userMessageId: userMessage.id,
      type: 'chat',
      status: 'pending',
      error: '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      apiKey: req.body.apiKey || DEFAULT_CHAT_API_KEY,
      model,
      temperature: req.body.temperature ?? 0.7,
      maxTokens: req.body.maxTokens ?? 2048,
      topP: req.body.topP ?? 1,
      enableWebSearch: req.body.enableWebSearch ?? DEFAULT_ENABLE_WEB_SEARCH,
    };

    registerAiTask(task);
    const latestSession = findAiSession(ownerLookup.ownerRef, session.id);
    if (latestSession) {
      latestSession.pendingTaskId = task.id;
      upsertAiSession(ownerLookup.ownerRef, latestSession);
    }

    setTimeout(() => {
      void runAiTask(task.id);
    }, 0);

    res.json({
      task: serializeAiTask(task),
      sessionId: session.id,
      messageId: assistantMessage.id,
    });
  });

  app.post('/api/ai-task/image', (req, res) => {
    const ownerLookup = resolveAiOwnerFromInput(req.body, { requireKnownUser: true });

    if (ownerLookup.error) {
      return res.status(req.body.guestId ? 400 : 404).json({ error: ownerLookup.error });
    }

    const prompt = String(req.body.prompt || '').trim();
    const images = Array.isArray(req.body.images) ? req.body.images.filter(item => typeof item === 'string' && item.trim()) : [];

    let imageProvider;
    try {
      imageProvider = resolveImageProvider(req.body.imageProvider);
    } catch (error) {
      return res.status(400).json({
        error: error instanceof Error ? error.message : '不支持的图片生成模型',
      });
    }

    if (!imageProvider.apiKey) {
      return res.status(503).json({ error: `${imageProvider.label} 图片模型尚未配置` });
    }

    if (!prompt) {
      return res.status(400).json({ error: '描述不能为空' });
    }

    let session = findAiSession(ownerLookup.ownerRef, req.body.sessionId);
    if (!session) {
      session = createAiSession(ownerLookup.ownerRef, {
        model: imageProvider.model,
        ownerId: ownerLookup.ownerId,
        ownerType: ownerLookup.ownerType,
      });
    } else if (session.model !== imageProvider.model) {
      session.model = imageProvider.model;
      upsertAiSession(ownerLookup.ownerRef, session);
    }

    appendAiMessage(ownerLookup.ownerRef, session.id, {
      role: 'user',
      content: prompt,
      images: images.length ? images : undefined,
      status: 'sent',
    });

    const assistantMessage = appendAiMessage(ownerLookup.ownerRef, session.id, {
      role: 'assistant',
      content: '正在提交图片任务...',
      imageGenerationStage: 'submitting',
      status: 'streaming',
    });

    const task = {
      id: generateEntityId('ai_task'),
      userId: ownerLookup.ownerType === 'user' ? ownerLookup.ownerId : '',
      ownerId: ownerLookup.ownerId,
      ownerType: ownerLookup.ownerType,
      sessionId: session.id,
      messageId: assistantMessage.id,
      type: 'image',
      status: 'pending',
      error: '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      imageProvider: imageProvider.id,
      imageStage: 'submitting',
      prompt,
      images,
    };

    registerAiTask(task);
    const latestSession = findAiSession(ownerLookup.ownerRef, session.id);
    if (latestSession) {
      latestSession.pendingTaskId = task.id;
      upsertAiSession(ownerLookup.ownerRef, latestSession);
    }

    setTimeout(() => {
      void runAiTask(task.id);
    }, 0);

    res.json({
      task: serializeAiTask(task),
      sessionId: session.id,
      messageId: assistantMessage.id,
    });
  });

  app.post('/api/ai-task/video', (req, res) => {
    const ownerLookup = resolveAiOwnerFromInput(req.body, { requireKnownUser: true });
    if (ownerLookup.error) {
      return res.status(req.body.guestId ? 400 : 404).json({ error: ownerLookup.error });
    }

    const prompt = String(req.body.prompt || '').trim();
    if (!prompt) {
      return res.status(400).json({ error: '视频提示词不能为空' });
    }

    let images;
    try {
      images = validateVideoReferenceImages(req.body.images);
    } catch (error) {
      return res.status(400).json({
        error: error instanceof Error ? error.message : '参考图格式不正确',
      });
    }

    const session = resolveOrCreateVideoSession(ownerLookup, req.body.sessionId);
    const userMessage = appendAiMessage(ownerLookup.ownerRef, session.id, {
      role: 'user',
      content: prompt,
      images: images.length ? images : undefined,
      status: 'sent',
    });
    const assistantMessage = appendAiMessage(ownerLookup.ownerRef, session.id, {
      role: 'assistant',
      content: '正在提交视频任务...',
      videoGenerationStage: 'submitting',
      status: 'streaming',
    });

    const now = Date.now();
    const task = {
      id: generateEntityId('ai_task'),
      userId: ownerLookup.ownerType === 'user' ? ownerLookup.ownerId : '',
      ownerId: ownerLookup.ownerId,
      ownerType: ownerLookup.ownerType,
      sessionId: session.id,
      messageId: assistantMessage.id,
      userMessageId: userMessage.id,
      type: 'video',
      status: 'pending',
      error: '',
      prompt,
      images,
      videoStage: 'submitting',
      createdAt: now,
      updatedAt: now,
    };

    videoJobStore.createVideoJob(task);
    registerAiTask(task);
    setSessionPendingTask(ownerLookup.ownerRef, session.id, task.id);
    setTimeout(() => {
      void runAiTask(task.id);
    }, 0);

    return res.json({
      task: serializeAiTask(task),
      sessionId: session.id,
      messageId: assistantMessage.id,
    });
  });

  app.get('/api/ai-task/:taskId', (req, res) => {
    const task = getOwnedTask(req);
    if (!task) {
      return res.status(404).json({ error: '任务不存在' });
    }

    res.json({ task: serializeAiTask(task) });
  });

  app.post('/api/ai-task/:taskId/cancel', (req, res) => {
    const task = getOwnedTask(req);
    if (!task) {
      return res.status(404).json({ error: '任务不存在' });
    }

    if (task.type === 'video') {
      return res.status(409).json({ error: '视频任务提交后不能取消' });
    }

    if (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') {
      return res.json({ task: serializeAiTask(task) });
    }

    task.status = 'cancelled';
    task.updatedAt = Date.now();
    task.abortController?.abort();

    res.json({ task: serializeAiTask(task) });
  });

  app.post('/api/chat', async (req, res) => {
    try {
      const { messages, config, apiKey, model, temperature, max_tokens, top_p, stream, enableWebSearch } = req.body;

      const finalModel = normalizeChatModel(model || config?.model || DEFAULT_CHAT_MODEL);
      const finalTemperature = temperature ?? config?.temperature ?? 0.7;
      const finalMaxTokens = max_tokens ?? config?.max_tokens ?? 2048;
      const finalTopP = top_p ?? config?.top_p ?? 1;
      const providerConfig = resolveChatProvider(finalModel, apiKey);
      const finalApiKey = providerConfig.apiKey;
      const finalEnableWebSearch = enableWebSearch ?? config?.enableWebSearch ?? DEFAULT_ENABLE_WEB_SEARCH;
      const containsImages = Array.isArray(messages) && messages.some(message => Array.isArray(message?.images) && message.images.length);
      const responsesInput = await buildResponsesInput(messages);
      const responsesInstructions = buildResponsesInstructions(messages);

      if (!finalApiKey) {
        return res.status(400).json({ error: { message: 'API Key is required' } });
      }

      if (!responsesInput.length) {
        return res.status(400).json({ error: { message: 'At least one non-system message is required' } });
      }

      const chatCompletionsMessages = buildChatCompletionsMessages(responsesInput, responsesInstructions);
      const requestBody = providerConfig.protocol === 'chat_completions'
        ? buildChatCompletionsPayload({
            model: providerConfig.model,
            messages: chatCompletionsMessages,
            temperature: finalTemperature,
            maxTokens: finalMaxTokens,
            topP: finalTopP,
            stream: stream !== undefined ? stream : true,
            extraFields: providerConfig.provider === 'deepseek'
              ? { thinking: { type: 'disabled' } }
              : undefined,
          })
        : {
            model: providerConfig.model,
            input: responsesInput,
            instructions: responsesInstructions,
            temperature: finalTemperature,
            max_output_tokens: finalMaxTokens,
            top_p: finalTopP,
            stream: stream !== undefined ? stream : true,
            ...(finalEnableWebSearch
              ? {
                  tools: [{ type: 'web_search' }],
                  tool_choice: 'auto',
                }
              : {}),
          };

      const response = await upstreamFetch(providerConfig.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${finalApiKey}`,
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorText = await response.text();
        let errorMessage = `API Error: ${response.status}`;

        try {
          const errorJson = JSON.parse(errorText);
          errorMessage = errorJson.error?.message || errorJson.message || errorMessage;
        } catch {
          if (errorText) {
            errorMessage = errorText;
          }
        }

        if (containsImages && errorMessage.includes('upstream_error')) {
          errorMessage = `当前接口的 ${finalModel} 暂不支持图片识别，请更换支持视觉的模型或接口。`;
        }

        return res.status(response.status).json({
          error: { message: errorMessage },
        });
      }

      await streamResponse(res, response);
    } catch (error) {
      console.error('Proxy error:', error);
      res.status(500).json({
        error: { message: error instanceof Error ? error.message : 'Internal server error' },
      });
    }
  });

  app.post('/api/image-generation', async (req, res) => {
    try {
      const { prompt, images, apiKey } = req.body;
      const finalApiKey = DEFAULT_IMAGE_API_KEY || apiKey || DEFAULT_CHAT_API_KEY;
      const normalizedPrompt = String(prompt || '').trim();
      const sourceImages = Array.isArray(images) ? images.filter((item) => typeof item === 'string' && item.trim()) : [];

      if (!finalApiKey) {
        return res.status(400).json({ error: 'API Key is required' });
      }

      if (!normalizedPrompt) {
        return res.status(400).json({ error: 'Prompt is required' });
      }

      const isImageEdit = sourceImages.length > 0;
      let response;
      let requestPrompt = normalizedPrompt;

      if (isImageEdit) {
        const formData = new FormData();
        formData.append('model', DEFAULT_IMAGE_MODEL);
        formData.append('prompt', requestPrompt);
        appendOptionalImageSize(formData, requestPrompt);

        sourceImages.slice(0, 4).forEach((image, index) => {
          const uploadPart = dataUrlToUploadPart(image, index);
          formData.append('image', uploadPart.blob, uploadPart.fileName);
        });

        response = await upstreamFetch(`${DEFAULT_IMAGE_API_URL}/v1/images/edits`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${finalApiKey}`,
          },
          body: formData,
        });
      } else {
        response = await upstreamFetch(`${DEFAULT_IMAGE_API_URL}/v1/images/generations`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${finalApiKey}`,
          },
          body: JSON.stringify(appendOptionalImageSize({
            model: DEFAULT_IMAGE_MODEL,
            prompt: requestPrompt,
          }, requestPrompt)),
        });
      }

      if (!response.ok) {
        let errorText = await response.text();
        let errorMessage = parseUpstreamErrorMessage(errorText, `Image API Error: ${response.status}`);

        if (response.status === 429 || isRateLimitErrorMessage(errorMessage)) {
          return res.status(429).json({ error: '图片上游当前限流，请稍后重试' });
        }

        if (!isImageEdit && errorMessage.includes('Upstream request failed')) {
          const compatiblePrompt = buildCompatibleImagePrompt(normalizedPrompt);

          if (compatiblePrompt && compatiblePrompt !== normalizedPrompt) {
            requestPrompt = compatiblePrompt;

            response = await upstreamFetch(`${DEFAULT_IMAGE_API_URL}/v1/images/generations`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${finalApiKey}`,
              },
              body: JSON.stringify(appendOptionalImageSize({
                model: DEFAULT_IMAGE_MODEL,
                prompt: requestPrompt,
              }, requestPrompt)),
            });

            if (response.ok) {
              const payload = await response.json();
              const generatedImages = await resolveGeneratedImages(payload);

              if (!generatedImages.length) {
                return res.status(502).json({ error: '上游未返回图片结果' });
              }

              return res.json({
                images: generatedImages,
                mode: 'generate',
                model: DEFAULT_IMAGE_MODEL,
              });
            }

            errorText = await response.text();
            errorMessage = parseUpstreamErrorMessage(errorText, `Image API Error: ${response.status}`);
          }
        }

        return res.status(response.status).json({ error: errorMessage });
      }

      const payload = await response.json();
      const generatedImages = await resolveGeneratedImages(payload);

      if (!generatedImages.length) {
        return res.status(502).json({ error: '上游未返回图片结果' });
      }

      res.json({
        images: generatedImages,
        mode: isImageEdit ? 'edit' : 'generate',
        model: DEFAULT_IMAGE_MODEL,
      });
    } catch (error) {
      console.error('Image generation proxy error:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Image generation failed',
      });
    }
  });
}
