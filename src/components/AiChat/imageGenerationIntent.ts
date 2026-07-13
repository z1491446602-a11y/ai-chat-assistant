const IMAGE_GENERATION_PATTERN = /(图片生成|生成图片|生成一张|来一张图|画一张|画一个|文生图|图生图|(?:生成|制作|创建|绘制|画|设计)(?:一张|一个)?(?:图像|照片|海报|头像|壁纸|封面|插画|流程图))/i;
const IMAGE_DISCUSSION_PATTERN = /(如何|怎么|怎样|为什么|解释|介绍|分析|原则|教程|方法)/i;
const DIRECT_IMAGE_REQUEST_PATTERN = /^(?:生成|制作|创建|绘制|画|设计|来一张)|(?:帮我|给我|为我|请(?:你)?)(?:生成|制作|创建|绘制|画|设计)/i;
const IMAGE_EDIT_ACTION_PATTERN = /(扩图|阔图|拓图|扩展|延展|外扩|补全画面|补全图片|修改|重绘|调整|改成|换成|移除|去掉|添加)/i;
const IMAGE_SPECIFIC_EDIT_PATTERN = /(扩图|阔图|拓图|扩展|延展|外扩|补全画面|补全图片|重绘)/i;
const GENERIC_EDIT_PATTERN = /(修改|调整|改成|换成|移除|去掉|添加)/i;
const IMAGE_EDIT_CONTEXT_PATTERN = /(图片|图像|照片|画面|背景|前景|人物|人像|主体|颜色|色调|构图|尺寸|比例|边缘|文字|水印|光线|天空|月亮|路人)/i;
const IMAGE_REFERENCE_PATTERN = /(上一张|上张图|前一张|(?:刚才|刚刚|之前)(?:(?:的|那)?(?:一?张)(?:图片|图)?|的(?:图片|图))|原图|这张图|该图|参考图)/i;
const CONTINUE_PATTERN = /(继续|接着|再)/i;

function hasContinuedImageEdit(text: string) {
  return CONTINUE_PATTERN.test(text)
    && (
      IMAGE_SPECIFIC_EDIT_PATTERN.test(text)
      || (GENERIC_EDIT_PATTERN.test(text) && IMAGE_EDIT_CONTEXT_PATTERN.test(text))
    );
}

function hasImageGenerationIntent(text: string) {
  return IMAGE_GENERATION_PATTERN.test(text)
    && (!IMAGE_DISCUSSION_PATTERN.test(text) || DIRECT_IMAGE_REQUEST_PATTERN.test(text));
}

export function detectImageGenerationMode(input: string, imageCount: number): 'generate' | 'edit' | null {
  const text = input.trim();
  if (!text) return null;

  const hasReference = IMAGE_REFERENCE_PATTERN.test(text);
  const hasEditAction = IMAGE_EDIT_ACTION_PATTERN.test(text);
  if ((hasReference && hasEditAction) || hasContinuedImageEdit(text)) {
    return 'edit';
  }
  if (imageCount > 0 && (hasReference || hasEditAction || hasImageGenerationIntent(text))) {
    return 'edit';
  }
  if (!hasImageGenerationIntent(text)) {
    return null;
  }
  return imageCount > 0 || hasReference ? 'edit' : 'generate';
}
