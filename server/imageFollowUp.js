const previousImagePattern = /(上一张|上张图|前一张|(?:刚才|刚刚|之前)(?:(?:的|那)?(?:一?张)(?:图片|图)?|的(?:图片|图))|原图|这张图|该图|参考图)/i;
const imageEditPattern = /(扩图|阔图|拓图|扩展|延展|外扩|补全画面|补全图片|修改|重绘|调整|改成|换成|移除|去掉|添加)/i;
const imageSpecificEditPattern = /(扩图|阔图|拓图|扩展|延展|外扩|补全画面|补全图片|重绘)/i;
const genericEditPattern = /(修改|调整|改成|换成|移除|去掉|添加)/i;
const imageEditContextPattern = /(图片|图像|照片|画面|背景|前景|人物|人像|主体|颜色|色调|构图|尺寸|比例|边缘|文字|水印|光线|天空|月亮|路人)/i;
const continuePattern = /(继续|接着|再)/i;

export function isPreviousImageEditPrompt(prompt) {
  const normalizedPrompt = String(prompt || '').trim();
  const continuedImageEdit = continuePattern.test(normalizedPrompt)
    && (
      imageSpecificEditPattern.test(normalizedPrompt)
      || (
        genericEditPattern.test(normalizedPrompt)
        && imageEditContextPattern.test(normalizedPrompt)
      )
    );
  return (previousImagePattern.test(normalizedPrompt) && imageEditPattern.test(normalizedPrompt))
    || continuedImageEdit;
}

export function findLatestAssistantImage(session) {
  const messages = Array.isArray(session?.messages) ? session.messages : [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== 'assistant' || !Array.isArray(message.images)) {
      continue;
    }
    const image = message.images.find(item => typeof item === 'string' && item.trim());
    if (image) {
      return image.trim();
    }
  }
  return '';
}

export function resolveImageTaskReferences({ prompt, explicitImages, session }) {
  const normalizedExplicitImages = Array.isArray(explicitImages)
    ? explicitImages.filter(item => typeof item === 'string' && item.trim()).map(item => item.trim())
    : [];
  if (normalizedExplicitImages.length) {
    return normalizedExplicitImages;
  }
  if (!isPreviousImageEditPrompt(prompt)) {
    return [];
  }

  const latestImage = findLatestAssistantImage(session);
  if (!latestImage) {
    throw new Error('当前会话中没有可用于编辑的上一张图片，请先上传图片');
  }
  return [latestImage];
}

export async function prepareImageTaskInput({
  prompt,
  explicitImages,
  session,
  resolveImageReferences,
}) {
  const displayImages = resolveImageTaskReferences({ prompt, explicitImages, session });
  const requestImages = await resolveImageReferences(displayImages);
  return { displayImages, requestImages };
}
