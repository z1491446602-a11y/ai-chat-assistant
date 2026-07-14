import { Image, ReceiptText, RefreshCw, TicketCheck, Video } from 'lucide-react';
import type { PointTransactionRecord } from '@/services/authApi';

interface AccountUsageHistoryProps {
  transactions: PointTransactionRecord[] | null;
  loading: boolean;
  error: string;
  onRetry: () => void;
}

const dateFormatter = new Intl.DateTimeFormat('zh-CN', {
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

function formatDate(value: string | number) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '时间未知' : dateFormatter.format(date);
}

function transactionMeta(transaction: PointTransactionRecord) {
  if (transaction.type === 'credit') {
    return {
      title: transaction.reason === 'redeem' ? '兑换码到账' : '积分到账',
      amount: `+${transaction.points.toLocaleString('zh-CN')} 积分`,
      amountClass: 'text-emerald-700',
      Icon: TicketCheck,
    };
  }

  const taskLabel = transaction.taskType === 'video' ? '视频生成' : '图片生成';
  if (transaction.type === 'release') {
    return {
      title: `${taskLabel}未扣费`,
      amount: '未扣费',
      amountClass: 'text-slate-600',
      Icon: transaction.taskType === 'video' ? Video : Image,
    };
  }

  return {
    title: taskLabel,
    amount: `${transaction.points.toLocaleString('zh-CN')} 积分`,
    amountClass: 'text-slate-900',
    Icon: transaction.taskType === 'video' ? Video : Image,
  };
}

export function AccountUsageHistory({
  transactions,
  loading,
  error,
  onRetry,
}: AccountUsageHistoryProps) {
  if (loading) {
    return (
      <div aria-label="正在加载使用记录" className="space-y-3" role="status">
        {[0, 1, 2].map(index => (
          <div className="flex min-h-16 animate-pulse items-center gap-3" key={index}>
            <span className="h-9 w-9 shrink-0 rounded-md bg-slate-200" />
            <span className="min-w-0 flex-1 space-y-2">
              <span className="block h-3 w-24 rounded bg-slate-200" />
              <span className="block h-3 w-32 rounded bg-slate-100" />
            </span>
            <span className="h-3 w-16 rounded bg-slate-200" />
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-44 flex-col items-center justify-center px-4 text-center">
        <ReceiptText aria-hidden="true" className="h-7 w-7 text-slate-400" />
        <p className="mt-3 text-sm font-medium text-slate-800">使用记录加载失败</p>
        <p className="mt-1 text-sm text-slate-500" role="alert">{error}</p>
        <button
          className="mt-4 inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 transition-colors hover:border-sky-300 hover:text-sky-700 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2"
          onClick={onRetry}
          type="button"
        >
          <RefreshCw aria-hidden="true" className="h-4 w-4" />
          重新加载
        </button>
      </div>
    );
  }

  if (!transactions?.length) {
    return (
      <div className="flex min-h-44 flex-col items-center justify-center px-4 text-center">
        <ReceiptText aria-hidden="true" className="h-7 w-7 text-slate-400" />
        <p className="mt-3 text-sm font-medium text-slate-800">暂无使用记录</p>
        <p className="mt-1 text-sm text-slate-500">积分变化会显示在这里</p>
      </div>
    );
  }

  return (
    <ol aria-label="最近使用记录" className="divide-y divide-slate-200">
      {transactions.map(transaction => {
        const { title, amount, amountClass, Icon } = transactionMeta(transaction);
        return (
          <li className="flex min-h-16 items-center gap-3 py-3" key={transaction.id}>
            <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-600">
              <Icon aria-hidden="true" className="h-4 w-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-slate-900">{title}</span>
              <span className="mt-0.5 block text-xs text-slate-500">
                {formatDate(transaction.createdAt)} · 余额 {transaction.balance.toLocaleString('zh-CN')}
              </span>
            </span>
            <span className={`shrink-0 text-sm font-semibold tabular-nums ${amountClass}`}>
              {amount}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
