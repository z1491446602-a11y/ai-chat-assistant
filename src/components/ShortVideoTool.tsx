import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { ArrowLeft, Clipboard, Download, ExternalLink, Film, Image as ImageIcon, Link2, LoaderCircle, Music2, ShieldCheck } from 'lucide-react';
import { parseShortVideo, type ShortVideoPlatform, type ShortVideoResult } from '@/services/shortVideosApi';

const platforms: Array<{ id: ShortVideoPlatform; name: string; domains: string[] }> = [
  { id: 'douyin', name: '抖音', domains: ['douyin.com', 'iesdouyin.com'] },
  { id: 'kuaishou', name: '快手', domains: ['kuaishou.com', 'gifshow.com'] },
  { id: 'xiaohongshu', name: '小红书', domains: ['xiaohongshu.com', 'xhslink.com', 'xhs.com'] },
  { id: 'bilibili', name: 'B站', domains: ['bilibili.com', 'b23.tv'] },
];

type ShortVideoToolProps = { onGoHome: () => void; onOpenChat: () => void };

function MediaLink({ href, children }: { href: string; children: ReactNode }) {
  return <a href={href} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition-colors hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2">{children}<ExternalLink className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" /></a>;
}

export function ShortVideoTool({ onGoHome, onOpenChat }: ShortVideoToolProps) {
  const [platform, setPlatform] = useState<ShortVideoPlatform>('douyin');
  const [shareUrl, setShareUrl] = useState('');
  const [result, setResult] = useState<ShortVideoResult | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const activePlatform = useMemo(() => platforms.find(item => item.id === platform) || platforms[0], [platform]);

  const updateShareUrl = (value: string) => {
    setShareUrl(value);
    const normalized = value.toLowerCase();
    const detected = platforms.find(item => item.domains.some(domain => normalized.includes(domain)));
    if (detected) setPlatform(detected.id);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!shareUrl.trim()) {
      setError('请先粘贴分享链接。');
      return;
    }
    setLoading(true);
    setError('');
    setResult(null);
    try {
      setResult(await parseShortVideo(platform, shareUrl));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '解析失败，请稍后重试。');
    } finally {
      setLoading(false);
    }
  };

  const handlePaste = async () => {
    try {
      updateShareUrl(await navigator.clipboard.readText());
    } catch {
      setError('无法读取剪贴板，请手动粘贴分享链接。');
    }
  };

  return (
    <div className="min-h-[100dvh] bg-[#f6faff] text-slate-950">
      <header className="border-b border-slate-200/80 bg-white/85 backdrop-blur-sm"><div className="mx-auto flex min-h-[72px] w-full max-w-[1120px] items-center justify-between gap-4 px-5 sm:px-8">
        <button type="button" onClick={onGoHome} className="inline-flex min-h-11 items-center gap-2 rounded-2xl px-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-950"><ArrowLeft className="h-5 w-5" strokeWidth={1.8} aria-hidden="true" />返回首页</button>
        <button type="button" onClick={onOpenChat} className="inline-flex min-h-11 items-center gap-2 rounded-2xl bg-blue-600 px-4 text-sm font-semibold text-white shadow-[0_10px_24px_rgba(37,99,235,0.2)] transition-colors hover:bg-blue-700">打开对话<ArrowLeft className="h-4 w-4 rotate-180" strokeWidth={1.8} aria-hidden="true" /></button>
      </div></header>

      <main className="mx-auto w-full max-w-[1120px] px-5 py-10 sm:px-8 sm:py-14">
        <section className="max-w-2xl"><div className="inline-flex items-center gap-2 rounded-full border border-blue-100 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700"><ShieldCheck className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />无需登录，直接解析公开分享链接</div><h1 className="mt-5 text-4xl font-semibold leading-tight text-slate-950 sm:text-5xl">视频去水印</h1><p className="mt-4 text-base leading-7 text-slate-600 sm:text-lg">粘贴公开分享链接，获取原始视频、图集和音频。支持抖音、快手、小红书和 B 站。</p></section>

        <section className="mt-10 rounded-[28px] border border-white bg-white p-5 shadow-[0_24px_65px_rgba(45,91,162,0.12)] sm:p-8"><form onSubmit={handleSubmit} className="space-y-5">
          <fieldset><legend className="text-sm font-semibold text-slate-800">来源平台</legend><div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">{platforms.map(item => <button key={item.id} type="button" aria-pressed={item.id === platform} onClick={() => setPlatform(item.id)} className={`min-h-12 rounded-2xl border px-3 text-sm font-medium transition-colors ${item.id === platform ? 'border-blue-600 bg-blue-600 text-white shadow-[0_8px_18px_rgba(37,99,235,0.18)]' : 'border-slate-200 bg-white text-slate-600 hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700'}`}>{item.name}</button>)}</div></fieldset>
          <div><label htmlFor="short-video-url" className="block text-sm font-semibold text-slate-800">分享链接</label><div className="mt-3 flex flex-col gap-3 sm:flex-row"><div className="relative min-w-0 flex-1"><Link2 className="pointer-events-none absolute left-4 top-4 h-5 w-5 text-slate-400" strokeWidth={1.8} aria-hidden="true" /><input id="short-video-url" type="text" value={shareUrl} onChange={event => updateShareUrl(event.target.value)} placeholder={`粘贴${activePlatform.name}公开分享链接`} autoComplete="off" inputMode="url" className="min-h-[52px] w-full rounded-2xl border border-slate-200 bg-slate-50 py-3 pl-12 pr-4 text-base text-slate-900 outline-none transition-colors placeholder:text-slate-400 focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-100" /></div><button type="button" onClick={() => void handlePaste()} className="inline-flex min-h-[52px] items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 hover:border-blue-200 hover:bg-blue-50"><Clipboard className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />粘贴</button><button type="submit" disabled={loading} className="inline-flex min-h-[52px] items-center justify-center gap-2 rounded-2xl bg-blue-600 px-6 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50">{loading ? <LoaderCircle className="h-5 w-5 animate-spin" strokeWidth={1.8} aria-hidden="true" /> : <Film className="h-5 w-5" strokeWidth={1.8} aria-hidden="true" />}{loading ? '解析中' : '开始解析'}</button></div><p className="mt-3 text-sm leading-6 text-slate-500">仅支持公开内容链接，请确认内容的使用权。</p>{error && <p role="alert" className="mt-3 text-sm font-medium text-rose-600">{error}</p>}</div>
        </form></section>

        {result && <section className="mt-8 border-t border-slate-200 pt-8" aria-live="polite"><div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start"><div className="min-w-0"><p className="text-sm font-medium text-blue-700">解析完成</p><h2 className="mt-1 break-words text-2xl font-semibold text-slate-950">{result.title}</h2>{(result.author || result.description) && <p className="mt-2 max-w-2xl break-words text-sm leading-6 text-slate-600">{result.author ? `${result.author} · ` : ''}{result.description}</p>}</div>{result.duration && <span className="w-fit rounded-full bg-slate-100 px-3 py-1.5 text-sm text-slate-600">{result.duration}</span>}</div>
          {result.videos.length > 0 && <div className="mt-6 grid gap-5 lg:grid-cols-2">{result.videos.map((url, index) => <div key={url} className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-950"><video controls preload="metadata" poster={index === 0 ? result.cover || undefined : undefined} className="block aspect-video w-full bg-slate-950" src={url}>您的浏览器不支持视频播放。</video><div className="flex items-center justify-between gap-3 bg-white p-3"><span className="text-sm font-medium text-slate-700">{index === 0 ? '原始视频' : `备用视频 ${index + 1}`}</span><a href={result.videoDownloads[index] || url} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 hover:border-blue-200 hover:bg-blue-50"><Download className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />下载</a></div></div>)}</div>}
          {result.images.length > 0 && <div className="mt-8"><div className="flex items-center gap-2 text-sm font-semibold text-slate-800"><ImageIcon className="h-5 w-5 text-blue-600" strokeWidth={1.8} aria-hidden="true" />图集</div><div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">{result.images.map((url, index) => <div key={url} className="overflow-hidden rounded-2xl border border-slate-200 bg-white"><a href={url} target="_blank" rel="noreferrer" className="group block"><img src={url} alt={`${result.title} 图片 ${index + 1}`} loading="lazy" className="aspect-square w-full object-cover transition-transform duration-200 group-hover:scale-[1.03]" /></a><div className="flex items-center justify-between gap-2 border-t border-slate-100 px-3 py-2"><span className="text-xs font-medium text-slate-500">原图 {index + 1}</span><a href={result.imageDownloads[index] || url} className="inline-flex min-h-9 items-center gap-1.5 rounded-xl px-2 text-xs font-semibold text-blue-700 hover:bg-blue-50"><Download className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />下载</a></div></div>)}</div></div>}
          {result.music.length > 0 && <div className="mt-8 flex flex-wrap items-center gap-3"><span className="inline-flex items-center gap-2 text-sm font-semibold text-slate-800"><Music2 className="h-5 w-5 text-blue-600" strokeWidth={1.8} aria-hidden="true" />音频</span>{result.music.map(url => <MediaLink key={url} href={url}><Download className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />打开原始音频</MediaLink>)}</div>}
        </section>}
      </main>
    </div>
  );
}
