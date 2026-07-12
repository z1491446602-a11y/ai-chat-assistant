export function createAiTaskStore({
  findAiSession,
  upsertAiSession,
  patchAiMessage,
  clearAiSessionTask,
  sanitizeAiMessage,
  buildVoiceReplyMessages,
  ensureVoiceReplyText,
  performVoiceSynthesis,
  performStreamingChatCompletion,
  performImageGeneration,
  videoProvider,
  videoFileStore,
  videoJobStore,
  isKittyVoiceModel,
  resolveKittyVoiceProfile,
  VOICE_STREAMING_TEXT,
  VOICE_REPLY_TEMPERATURE,
  VOICE_REPLY_MAX_TOKENS,
  VOICE_REPLY_TOP_P,
}) {
  const aiTasks = new Map();
  const videoStageContent = {
    submitting: '正在提交视频任务...',
    queued: '视频任务已排队...',
    processing: '视频正在生成中...',
    downloading: '正在下载视频...',
    validating: '正在验证并保存视频...',
  };

  function getImageTaskProgressText(task, stage = 'generating') {
    const isEdit = Array.isArray(task?.images) && task.images.length > 0;

    switch (stage) {
      case 'submitting':
        return isEdit ? '正在提交图生图任务...' : '正在提交生图任务...';
      case 'receiving':
        return isEdit ? '正在接收图生图结果...' : '正在接收图片结果...';
      case 'persisting':
        return isEdit ? '正在保存图生图结果...' : '正在保存图片结果...';
      case 'completed':
        return isEdit ? '已完成图生图。' : '已生成图片。';
      case 'generating':
      default:
        return isEdit ? '正在图生图中...' : '正在生成图片中...';
    }
  }

  function getTaskOwnerRef(task) {
    if (!task) {
      return null;
    }

    if (task.ownerType === 'guest') {
      return { guestId: task.ownerId };
    }

    return { userId: task.ownerId || task.userId };
  }

  function getAiTask(taskId) {
    return aiTasks.get(String(taskId || '').trim()) || null;
  }

  function registerAiTask(task) {
    aiTasks.set(task.id, task);
    return task;
  }

  function updateVideoStage(task, stage) {
    const content = videoStageContent[stage];
    if (!content) {
      return;
    }

    task.videoStage = stage;
    task.partialContent = content;
    task.updatedAt = Date.now();
    videoJobStore.patchVideoJob(task.id, {
      stage,
      status: 'running',
      upstreamTaskId: task.upstreamTaskId,
    });
    patchAiMessage(getTaskOwnerRef(task), task.sessionId, task.messageId, {
      content,
      videoGenerationStage: stage,
      status: 'streaming',
    });
  }

  function updateImageStage(task, stage) {
    const content = getImageTaskProgressText(task, stage);
    task.imageStage = stage;
    task.partialContent = content;
    task.updatedAt = Date.now();
    patchAiMessage(getTaskOwnerRef(task), task.sessionId, task.messageId, {
      content,
      imageGenerationStage: stage,
      progressPercent: undefined,
      status: 'streaming',
    });
  }

  function completeVideoTask(task, video) {
    const normalizedVideo = {
      videoUrl: video.videoUrl,
      videoMimeType: video.videoMimeType || 'video/mp4',
      videoFileName: video.videoFileName || video.fileName,
      videoFileSize: video.videoFileSize || video.size,
      videoDuration: video.videoDuration || video.duration,
      videoWidth: video.videoWidth || video.width,
      videoHeight: video.videoHeight || video.height,
    };
    Object.assign(task, normalizedVideo);
    task.partialContent = '视频生成完成';
    task.videoStage = undefined;
    task.updatedAt = Date.now();
    patchAiMessage(getTaskOwnerRef(task), task.sessionId, task.messageId, {
      content: '视频生成完成',
      ...normalizedVideo,
      videoGenerationStage: undefined,
      status: 'sent',
    });
    videoJobStore.patchVideoJob(task.id, {
      status: 'completed',
      stage: 'validating',
      error: '',
      upstreamTaskId: task.upstreamTaskId,
    });
  }

  function getVideoFailureText(task, error) {
    if (/timed out|超时/i.test(String(error?.message || ''))) {
      return '视频状态查询超时，请联系管理员继续核查。';
    }
    if (task.videoStage === 'submitting') {
      return '视频任务提交失败，请稍后重试。';
    }
    if (task.videoStage === 'queued' || task.videoStage === 'processing') {
      return '上游视频生成失败，请稍后重试。';
    }
    if (task.videoStage === 'downloading') {
      return '视频下载失败，请稍后重试。';
    }
    if (task.videoStage === 'validating') {
      return '视频校验或保存失败，请稍后重试。';
    }
    return '视频生成失败，请稍后重试。';
  }

  function serializeAiTask(task) {
    if (!task) {
      return null;
    }

    return {
      id: task.id,
      userId: task.userId,
      sessionId: task.sessionId,
      messageId: task.messageId,
      type: task.type,
      status: task.status,
      error: task.error || '',
      content: typeof task.partialContent === 'string' ? task.partialContent : '',
      images: Array.isArray(task.partialImages) && task.partialImages.length ? task.partialImages : undefined,
      files: Array.isArray(task.partialFiles) && task.partialFiles.length ? task.partialFiles : undefined,
      audioUrl: typeof task.audioUrl === 'string' && task.audioUrl.trim() ? task.audioUrl.trim() : undefined,
      audioMimeType: typeof task.audioMimeType === 'string' && task.audioMimeType.trim() ? task.audioMimeType.trim() : undefined,
      duration: Number.isFinite(task.duration) && task.duration > 0 ? Number(task.duration) : undefined,
      progressPercent: Number.isFinite(task.progressPercent) ? Number(task.progressPercent) : undefined,
      imageStage: task.imageStage,
      imageFileName: task.imageFileName,
      imageFileSize: task.imageFileSize,
      imageMimeType: task.imageMimeType,
      imageWidth: task.imageWidth,
      imageHeight: task.imageHeight,
      imageProvider: task.imageProvider,
      videoStage: task.videoStage,
      videoUrl: task.videoUrl,
      videoMimeType: task.videoMimeType,
      videoFileName: task.videoFileName,
      videoFileSize: task.videoFileSize,
      videoDuration: task.videoDuration,
      videoWidth: task.videoWidth,
      videoHeight: task.videoHeight,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
    };
  }

  async function runAiTask(taskId) {
    const task = getAiTask(taskId);
    if (!task || task.status !== 'pending') {
      return;
    }

    const ownerRef = getTaskOwnerRef(task);
    task.status = 'running';
    task.updatedAt = Date.now();
    const session = findAiSession(ownerRef, task.sessionId);
    if (session) {
      session.pendingTaskId = task.id;
      upsertAiSession(ownerRef, session);
    }

    const controller = new AbortController();
    task.abortController = controller;
    let taskHeartbeatTimer = null;

    try {
      if (task.type === 'chat') {
        const activeSession = findAiSession(ownerRef, task.sessionId);
        const upstreamMessages = (activeSession?.messages || [])
          .filter(message => String(message.id) !== String(task.messageId))
          .map(sanitizeAiMessage);
        const voiceMode = isKittyVoiceModel(task.model);
        task.partialContent = voiceMode ? VOICE_STREAMING_TEXT : '';
        task.partialFiles = [];
        if (voiceMode) {
          patchAiMessage(ownerRef, task.sessionId, task.messageId, {
            content: VOICE_STREAMING_TEXT,
            status: 'streaming',
          });

          const voiceProfile = resolveKittyVoiceProfile(task.model);
          const voiceMessages = buildVoiceReplyMessages(upstreamMessages, voiceProfile.replyPrompt);
          const result = await ensureVoiceReplyText({
            messages: voiceMessages,
            apiKey: task.apiKey,
            model: task.model,
            temperature: voiceProfile.replyTemperature ?? VOICE_REPLY_TEMPERATURE,
            maxTokens: Math.min(Number(task.maxTokens) || VOICE_REPLY_MAX_TOKENS, VOICE_REPLY_MAX_TOKENS),
            topP: VOICE_REPLY_TOP_P,
            enableWebSearch: false,
            signal: controller.signal,
          });

          const finalText = String(result.content || '').trim();
          if (!finalText) {
            throw new Error('语音模式未生成文本内容');
          }

          const audioPatch = await performVoiceSynthesis({
            text: finalText,
            signal: controller.signal,
            voiceModel: voiceProfile.model,
          });

          task.partialContent = finalText;
          task.partialFiles = result.files.length ? result.files : [];
          task.audioUrl = audioPatch.audioUrl || '';
          task.audioMimeType = audioPatch.audioMimeType || '';
          task.duration = Number(audioPatch.duration) || undefined;
          task.updatedAt = Date.now();

          patchAiMessage(ownerRef, task.sessionId, task.messageId, {
            content: finalText,
            files: result.files.length ? result.files : undefined,
            ...audioPatch,
            status: 'sent',
          });
        } else {
          const result = await performStreamingChatCompletion({
            messages: upstreamMessages,
            apiKey: task.apiKey,
            model: task.model,
            temperature: task.temperature,
            maxTokens: task.maxTokens,
            topP: task.topP,
            enableWebSearch: task.enableWebSearch,
            signal: controller.signal,
            onDelta: (content) => {
              task.partialContent = content;
              task.updatedAt = Date.now();
            },
            onFiles: (files) => {
              task.partialFiles = files;
              task.updatedAt = Date.now();
            },
          });

          patchAiMessage(ownerRef, task.sessionId, task.messageId, {
            content: result.content || task.partialContent || '已完成回复。',
            files: result.files.length ? result.files : (task.partialFiles?.length ? task.partialFiles : undefined),
            status: 'sent',
          });
        }
      } else if (task.type === 'image') {
        updateImageStage(task, 'submitting');
        taskHeartbeatTimer = setInterval(() => {
          task.updatedAt = Date.now();
        }, 1500);

        const result = await performImageGeneration({
          prompt: task.prompt,
          images: task.images,
          provider: task.imageProvider,
          signal: controller.signal,
          onProgress: (stage) => {
            updateImageStage(task, stage);
          },
        });

        task.partialContent = getImageTaskProgressText(task, 'completed');
        task.partialImages = Array.isArray(result.images) ? result.images : [];
        task.imageStage = undefined;
        task.imageFileName = result.imageFileName;
        task.imageFileSize = result.imageFileSize;
        task.imageMimeType = result.imageMimeType;
        task.imageWidth = result.imageWidth;
        task.imageHeight = result.imageHeight;
        task.imageProvider = result.imageProvider || task.imageProvider;
        task.updatedAt = Date.now();

        patchAiMessage(ownerRef, task.sessionId, task.messageId, {
          content: Array.isArray(task.images) && task.images.length ? '已完成图生图。' : '已生成图片。',
          images: result.images,
          imageGenerationStage: undefined,
          imageFileName: result.imageFileName,
          imageFileSize: result.imageFileSize,
          imageMimeType: result.imageMimeType,
          imageWidth: result.imageWidth,
          imageHeight: result.imageHeight,
          imageProvider: result.imageProvider || task.imageProvider,
          progressPercent: undefined,
          status: 'sent',
        });
      } else if (task.type === 'video') {
        videoJobStore.patchVideoJob(task.id, {
          status: 'running',
          stage: task.videoStage || 'submitting',
          upstreamTaskId: task.upstreamTaskId,
        });

        const existingVideo = await videoFileStore.inspectExistingVideo(task.id);
        if (existingVideo) {
          completeVideoTask(task, existingVideo);
        } else {
          let upstreamVideoUrl = '';
          if (!task.upstreamTaskId) {
            const submitted = await videoProvider.submit({
              prompt: task.prompt,
              images: task.images,
            });
            task.upstreamTaskId = submitted.id;
            if (submitted.status === 'completed' && submitted.videoUrl) {
              upstreamVideoUrl = submitted.videoUrl;
            } else {
              updateVideoStage(task, submitted.status === 'processing' ? 'processing' : 'queued');
            }
          }

          if (!upstreamVideoUrl) {
            upstreamVideoUrl = await videoProvider.poll(task.upstreamTaskId, (stage) => {
              updateVideoStage(task, stage);
            });
          }

          const video = await videoFileStore.downloadValidateAndSave({
            jobId: task.id,
            videoUrl: upstreamVideoUrl,
            onStage: (stage) => updateVideoStage(task, stage),
          });
          completeVideoTask(task, video);
        }
      }

      task.status = 'completed';
      task.updatedAt = Date.now();
    } catch (error) {
      if (task.type === 'video') {
        const failedStage = task.videoStage || 'submitting';
        const publicError = getVideoFailureText(task, error);
        task.status = 'failed';
        task.error = publicError;
        task.videoStage = undefined;
        task.updatedAt = Date.now();
        videoJobStore.patchVideoJob(task.id, {
          status: 'failed',
          stage: failedStage,
          error: publicError,
          upstreamTaskId: task.upstreamTaskId,
        });
        patchAiMessage(getTaskOwnerRef(task), task.sessionId, task.messageId, {
          content: publicError,
          videoGenerationStage: undefined,
          status: 'error',
        });
      } else {
        const isAbort = error instanceof Error && error.name === 'AbortError';
        task.status = isAbort ? 'cancelled' : 'failed';
        if (task.type === 'image') {
          task.imageStage = undefined;
        }
        task.error = error instanceof Error ? error.message : '任务失败';
        task.updatedAt = Date.now();

        patchAiMessage(getTaskOwnerRef(task), task.sessionId, task.messageId, {
          content: isAbort
            ? (task.type === 'image' ? '已停止生成。' : '已停止回复。')
            : `错误: ${task.error}`,
          imageGenerationStage: task.type === 'image' ? undefined : task.imageStage,
          progressPercent: task.type === 'image' ? undefined : task.progressPercent,
          status: isAbort ? 'sent' : 'error',
        });
      }
    } finally {
      if (taskHeartbeatTimer) {
        clearInterval(taskHeartbeatTimer);
      }
      delete task.abortController;
      clearAiSessionTask(getTaskOwnerRef(task), task.sessionId);
    }
  }

  function resumeVideoJobs() {
    const { recoverable, unknownSubmission } = videoJobStore.getRecoveryPlan();

    const failRecovery = (job, content) => {
      const ownerRef = job.ownerType === 'guest'
        ? { guestId: job.ownerId }
        : { userId: job.ownerId };
      videoJobStore.patchVideoJob(job.id, {
        status: 'failed',
        stage: job.stage || 'submitting',
        error: content,
        upstreamTaskId: job.upstreamTaskId,
      });
      patchAiMessage(ownerRef, job.sessionId, job.messageId, {
        content,
        videoGenerationStage: undefined,
        status: 'error',
      });
      clearAiSessionTask(ownerRef, job.sessionId);
    };

    for (const job of unknownSubmission) {
      failRecovery(job, '提交结果未知，为避免重复扣费未自动重试。');
    }

    let recoveredCount = 0;
    for (const job of recoverable) {
      const ownerRef = job.ownerType === 'guest'
        ? { guestId: job.ownerId }
        : { userId: job.ownerId };
      const session = findAiSession(ownerRef, job.sessionId);
      const userMessage = session?.messages?.find(message => String(message.id) === String(job.userMessageId));
      if (!session || !userMessage) {
        failRecovery(job, '视频任务恢复失败：原始消息不存在。');
        continue;
      }

      const task = {
        ...job,
        userId: job.ownerType === 'user' ? job.ownerId : '',
        type: 'video',
        status: 'pending',
        error: '',
        images: Array.isArray(userMessage.images) ? userMessage.images : [],
        videoStage: job.stage,
        updatedAt: Date.now(),
      };
      registerAiTask(task);
      session.pendingTaskId = task.id;
      upsertAiSession(ownerRef, session);
      recoveredCount += 1;
      setTimeout(() => {
        void runAiTask(task.id);
      }, 0);
    }

    return {
      recoveredCount,
      unknownSubmissionCount: unknownSubmission.length,
    };
  }

  return {
    getAiTask,
    registerAiTask,
    serializeAiTask,
    runAiTask,
    resumeVideoJobs,
  };
}
