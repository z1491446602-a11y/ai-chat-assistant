export function AiChatHeader() {
  return (
    <header className="flex min-h-16 shrink-0 items-center justify-center border-b border-slate-200 bg-white px-20 pb-2 pt-[calc(env(safe-area-inset-top)+0.5rem)] text-center sm:py-2">
      <div className="min-w-0">
        <h1
          className="truncate text-[15px] font-semibold leading-5 text-slate-900"
          style={{ fontFamily: '"Microsoft YaHei UI", "PingFang SC", "Noto Sans SC", system-ui, sans-serif' }}
        >
          人工智障
        </h1>
        <p className="mt-0.5 truncate text-xs leading-4 text-slate-500">内容由 AI 生成</p>
      </div>
    </header>
  );
}
