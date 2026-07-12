export function AiChatHeader() {
  return (
    <header className="flex min-h-14 shrink-0 items-center justify-center border-b border-sky-100/80 bg-white/94 px-20 pb-2 pt-[calc(env(safe-area-inset-top)+0.5rem)] text-center backdrop-blur sm:py-2">
      <div className="min-w-0">
        <h1 className="truncate text-sm font-semibold text-slate-900">AI 日常聊天助手</h1>
        <p className="mt-0.5 truncate text-[11px] leading-4 text-slate-500">内容由 AI 生成，请注意甄别</p>
      </div>
    </header>
  );
}
