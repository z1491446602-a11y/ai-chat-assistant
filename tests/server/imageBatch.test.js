import { describe, expect, it } from 'vitest';
import * as imageBatch from '../../server/imageBatch.js';

const { getImageRequestPrompts, getRequestedImageCount } = imageBatch;

describe('image batch prompt parsing', () => {
  it.each([
    ['生成2张赛博朋克海报', 2],
    ['帮我画三张猫咪图片', 3],
    ['生成 5 张产品图', 5],
    ['生成一张风景图', 1],
    ['画一幅 3:2 的横图', 1],
  ])('reads %s as %d image requests', (prompt, count) => {
    expect(getRequestedImageCount(prompt)).toBe(count);
  });

  it('rejects requests above the five-image batch maximum', () => {
    expect(() => getRequestedImageCount('生成6张图片')).toThrow('最多一次生成 5 张图片');
  });

  it.each([
    ['生成3张蝴蝶在小溪旁边飞舞的图片', '生成一张蝴蝶在小溪旁边飞舞的图片'],
    ['帮我画三张猫咪图片', '帮我画一张猫咪图片'],
    ['生成 5 张 16:9 产品图', '生成一张 16:9 产品图'],
    ['画一幅 3:2 的横图', '画一幅 3:2 的横图'],
  ])('turns the batch directive in %s into a single-image upstream prompt', (prompt, expected) => {
    expect(imageBatch.getSingleImageRequestPrompt(prompt)).toBe(expected);
  });

  it('splits numbered storyboards into one upstream prompt per requested image', () => {
    const prompt = [
      '生成五张图片，比例 16:9，写实风格，柔和自然光',
      '第一张：一只橘色小猫蹲在溪边的石头上。',
      '第二张：一只黑白花猫趴在溪边的草地上。',
      '第三张：一只灰色虎斑猫站在浅水里。',
      '第四张：一只白色小猫坐在溪流中央的圆石上。',
      '第五张：一只黑猫从岸边一跃而起。',
    ].join('\n');

    const prompts = getImageRequestPrompts(prompt, 5);

    expect(prompts).toHaveLength(5);
    expect(prompts[0]).toContain('一只橘色小猫');
    expect(prompts[1]).toContain('一只黑白花猫');
    expect(prompts[2]).toContain('一只灰色虎斑猫');
    expect(prompts[3]).toContain('一只白色小猫');
    expect(prompts[4]).toContain('一只黑猫');
    prompts.forEach((requestPrompt, index) => {
      expect(requestPrompt).toContain('16:9');
      expect(requestPrompt).toContain('写实风格');
      expect(requestPrompt).not.toContain('生成五张');
      prompts.forEach((otherPrompt, otherIndex) => {
        if (otherIndex !== index) {
          const descriptions = ['橘色小猫', '黑白花猫', '灰色虎斑猫', '白色小猫', '一只黑猫'];
          expect(requestPrompt).not.toContain(descriptions[otherIndex]);
        }
      });
    });
  });

  it.each([
    ['第1张：红色跑车\n第2张：蓝色跑车', ['红色跑车', '蓝色跑车']],
    ['1. 红色跑车\n2. 蓝色跑车', ['红色跑车', '蓝色跑车']],
    ['1、红色跑车\n2、蓝色跑车', ['红色跑车', '蓝色跑车']],
    ['1：红色跑车\n2：蓝色跑车', ['红色跑车', '蓝色跑车']],
  ])('supports numbered storyboard markers in %s', (storyboard, expectedDescriptions) => {
    const prompts = getImageRequestPrompts(`生成2张图片\n${storyboard}`, 2);
    expect(prompts[0]).toContain(expectedDescriptions[0]);
    expect(prompts[0]).not.toContain(expectedDescriptions[1]);
    expect(prompts[1]).toContain(expectedDescriptions[1]);
    expect(prompts[1]).not.toContain(expectedDescriptions[0]);
  });

  it('uses only the common prompt when a storyboard has fewer items than requested', () => {
    const prompts = getImageRequestPrompts([
      '生成4张图片，水彩风格，比例 3:2',
      '第一张：海边灯塔',
      '第二张：山间木屋',
    ].join('\n'), 4);

    expect(prompts[0]).toContain('海边灯塔');
    expect(prompts[1]).toContain('山间木屋');
    expect(prompts[2]).toContain('水彩风格');
    expect(prompts[2]).toContain('3:2');
    expect(prompts[2]).not.toContain('海边灯塔');
    expect(prompts[2]).not.toContain('山间木屋');
    expect(prompts[3]).toBe(prompts[2]);
  });

  it('applies explicit shared requirements written after the storyboard to every image', () => {
    const prompts = getImageRequestPrompts([
      '生成2张图片',
      '第一张：雪山日出',
      '第二张：海边日落',
      '统一要求：比例 16:9，电影感，暖色光线',
    ].join('\n'), 2);

    prompts.forEach(requestPrompt => {
      expect(requestPrompt).toContain('16:9');
      expect(requestPrompt).toContain('电影感');
      expect(requestPrompt).toContain('暖色光线');
    });
    expect(prompts[0]).not.toContain('海边日落');
    expect(prompts[1]).not.toContain('雪山日出');
  });

  it('splits Chinese storyboard markers written on the same line', () => {
    const prompts = getImageRequestPrompts(
      '生成3张图片，动漫风格 第一张：春天的森林 第二张：夏天的海边 第三张：秋天的山谷',
      3,
    );

    expect(prompts[0]).toContain('春天的森林');
    expect(prompts[0]).not.toContain('夏天的海边');
    expect(prompts[1]).toContain('夏天的海边');
    expect(prompts[1]).not.toContain('秋天的山谷');
    expect(prompts[2]).toContain('秋天的山谷');
    prompts.forEach(requestPrompt => expect(requestPrompt).toContain('动漫风格'));
  });

  it('does not treat aspect ratios or ordinary ordered lists as storyboards without batch intent', () => {
    const prompt = '构图要求：16:9\n1. 主体居中\n2. 暖色光线';
    expect(getImageRequestPrompts(prompt, 3)).toEqual([prompt, prompt, prompt]);
  });

  it.each(['16:9', '3:2', '9：16 竖版'])('keeps a standalone %s ratio as a shared requirement', (ratio) => {
    const prompts = getImageRequestPrompts([
      '生成2张图片',
      ratio,
      '第一张：森林',
      '第二张：海边',
    ].join('\n'), 2);

    prompts.forEach(requestPrompt => expect(requestPrompt).toContain(ratio));
    expect(prompts[0]).toContain('森林');
    expect(prompts[0]).not.toContain('海边');
    expect(prompts[1]).toContain('海边');
    expect(prompts[1]).not.toContain('森林');
  });

  it('reuses the single-image prompt when no numbered storyboard is present', () => {
    expect(getImageRequestPrompts('生成5张城市夜景图片，比例16:9', 5)).toEqual(
      Array(5).fill('生成一张城市夜景图片，比例16:9'),
    );
  });
});
