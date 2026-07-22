import {
  ArrowRight,
  Landmark,
  ShieldCheck,
} from 'lucide-react';
import catAvatarUrl from '@/assets/cat-avatar.jpg';
import chatPreviewUrl from '@/assets/chat-preview.png';

type HomePageProps = {
  onOpenChat: () => void;
  onOpenShortVideo: () => void;
};

export function HomePage({ onOpenChat, onOpenShortVideo }: HomePageProps) {
  return (
    <div className="home-page relative min-h-[100dvh] overflow-hidden bg-[#f6faff] text-slate-950">
      <div className="home-atmosphere" aria-hidden="true" />

      <div className="relative mx-auto flex min-h-[100dvh] w-full max-w-[1440px] flex-col px-5 sm:px-8 lg:px-12">
        <header className="flex min-h-[72px] shrink-0 items-center justify-between">
          <a href="/" className="inline-flex min-h-11 items-center gap-3 rounded-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2">
            <span className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-[14px] bg-[#2563eb] shadow-[0_10px_26px_rgba(37,99,235,0.22)]">
              <img
                src={catAvatarUrl}
                alt="人工智障猫咪头像"
                width="40"
                height="40"
                className="h-full w-full scale-[1.65] object-cover object-center"
              />
            </span>
            <span>
              <span className="block text-[15px] font-semibold leading-5 text-slate-950">人工智障</span>
              <span className="block text-xs leading-4 text-slate-500">内容由 AI 生成</span>
            </span>
          </a>
          <span className="ml-auto hidden text-sm text-slate-500 sm:block">AI 网页助手</span>
        </header>

        <main id="main-content" className="flex flex-1 flex-col justify-center py-10 sm:py-12 lg:py-14">
          <section className="grid items-center gap-12 lg:grid-cols-12 lg:gap-10 xl:gap-16">
            <div className="home-reveal lg:col-span-5">
              <h1 className="max-w-[8ch] text-[52px] font-semibold leading-[1.08] text-slate-950 sm:text-[64px] lg:text-[72px]">
                人工智障
              </h1>
              <p className="mt-6 max-w-[430px] text-lg leading-8 text-slate-600 sm:text-xl">
                一个能聊天、生成图片和视频的 AI 网页助手。
              </p>
              <button
                type="button"
                onClick={onOpenChat}
                className="home-primary-action group mt-9 grid min-h-[132px] w-full max-w-[400px] grid-cols-[minmax(0,1fr)_48px] items-center gap-5 overflow-visible rounded-[30px] border border-white/90 bg-[linear-gradient(135deg,rgba(255,255,255,0.98)_0%,rgba(250,253,255,0.96)_58%,rgba(231,241,255,0.92)_100%)] px-6 py-6 text-left shadow-[0_24px_70px_rgba(45,91,162,0.13),inset_0_1px_0_rgba(255,255,255,0.92)] transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-1 hover:border-blue-100 hover:shadow-[0_30px_78px_rgba(45,91,162,0.19),inset_0_1px_0_rgba(255,255,255,0.96)] active:translate-y-0 active:scale-[0.99] focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-4 sm:px-8"
              >
                <span className="min-w-0">
                  <span className="block text-xl font-semibold leading-7 text-blue-600">
                    打开人工智障网页版
                  </span>
                  <span className="mt-2 block text-sm font-normal leading-6 text-slate-500">
                    直接开始对话、图片和视频创作
                  </span>
                </span>
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-600 text-white shadow-[0_10px_24px_rgba(37,99,235,0.24)] transition-[background-color,transform] duration-200 group-hover:translate-x-1 group-hover:bg-blue-700" aria-hidden="true">
                  <ArrowRight className="h-5 w-5" strokeWidth={1.8} />
                </span>
              </button>
              <button
                type="button"
                onClick={onOpenShortVideo}
                className="home-primary-action group mt-4 grid min-h-[132px] w-full max-w-[400px] grid-cols-[minmax(0,1fr)_48px] items-center gap-5 overflow-visible rounded-[30px] border border-white/90 bg-[linear-gradient(135deg,rgba(255,255,255,0.98)_0%,rgba(250,253,255,0.96)_58%,rgba(231,241,255,0.92)_100%)] px-6 py-6 text-left shadow-[0_24px_70px_rgba(45,91,162,0.13),inset_0_1px_0_rgba(255,255,255,0.92)] transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-1 hover:border-blue-100 hover:shadow-[0_30px_78px_rgba(45,91,162,0.19),inset_0_1px_0_rgba(255,255,255,0.96)] active:translate-y-0 active:scale-[0.99] focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-4 sm:px-8"
              >
                <span className="min-w-0">
                  <span className="block text-xl font-semibold leading-7 text-blue-600">
                    视频去水印
                  </span>
                  <span className="mt-2 block text-sm font-normal leading-6 text-slate-500">
                    粘贴分享链接，获取清爽原视频
                  </span>
                </span>
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-600 text-white shadow-[0_10px_24px_rgba(37,99,235,0.24)] transition-[background-color,transform] duration-200 group-hover:translate-x-1 group-hover:bg-blue-700" aria-hidden="true">
                  <ArrowRight className="h-5 w-5" strokeWidth={1.8} />
                </span>
              </button>
            </div>

            <div className="home-product-visual lg:col-span-7">
              <div className="overflow-hidden rounded-[24px] border border-white/90 bg-white/80 shadow-[0_30px_90px_rgba(32,78,150,0.17),inset_0_1px_0_rgba(255,255,255,0.9)]">
                <img
                  src={chatPreviewUrl}
                  alt="人工智障网页版对话界面"
                  width="1440"
                  height="900"
                  className="block aspect-[16/10] w-full object-cover object-center"
                  decoding="async"
                />
              </div>
            </div>
          </section>
        </main>

        <footer className="flex shrink-0 flex-col gap-3 border-t border-slate-200/80 py-5 text-xs leading-5 text-slate-500 sm:flex-row sm:items-center sm:justify-between">
          <span>© 2026 人工智障</span>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-5">
            <a
              href="https://beian.miit.gov.cn/"
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-8 items-center gap-2 rounded-xl transition-colors hover:text-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
            >
              <Landmark className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />
              豫ICP备2026027242号
            </a>
            <a
              href="https://beian.mps.gov.cn/#/query/webSearch?code=41010502007797"
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-8 items-center gap-2 rounded-xl transition-colors hover:text-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
            >
              <ShieldCheck className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />
              豫公网安备41010502007797号
            </a>
          </div>
        </footer>
      </div>
    </div>
  );
}
