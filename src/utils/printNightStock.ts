import type { NightStockRequest } from '../types';
import { fenToYuan } from './money';
import { fmtDateTime } from './datetime';

const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

/** 同一备货单的纸质视图，不另建拣货单或改变出库/实收状态。 */
export function nightStockPrintHtml(order: NightStockRequest): string {
  if (!['approved', 'shipped', 'received'].includes(order.status)) throw Error('审核通过后才能打印拣货单');
  const rows = order.items.map((item, i) => `<tr><td>${i + 1}</td><td>${escape(item.name)}</td><td>${item.quantity}</td><td>${escape(item.receivedQuantity ?? '')}</td><td></td></tr>`).join('');
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>夜宵备货拣货交接单</title><style>@page{size:A4;margin:16mm}body{font:14px system-ui;color:#172c22}h1{font-size:24px}table{border-collapse:collapse;width:100%;margin:24px 0}th,td{border:1px solid #aaa;padding:12px;text-align:left}footer{margin-top:36px;display:flex;justify-content:space-between}.note{color:#555}</style><body><h1>夜宵备货 · 拣货 / 交接单</h1><p>备货单号：${escape(order.id)}</p><p>楼栋：${escape(order.buildingName)}　楼长：${escape(order.managerName)}</p><p>申请时间：${escape(fmtDateTime(order.createdAt))}　出库时间：${escape(order.shippedAt ? fmtDateTime(order.shippedAt) : '待出库')}</p><table><thead><tr><th>序号</th><th>商品</th><th>应发数量</th><th>实收数量</th><th>核对</th></tr></thead><tbody>${rows}</tbody></table><p>合计 ${order.items.reduce((sum, i) => sum + i.quantity, 0)} 件　申请货值 ¥${fenToYuan(order.totalValue)}</p><p class="note">请随货核对。实际收货请楼长在小程序确认；纸单不代替系统收货。</p><footer><span>拣货人：____________</span><span>交接人：____________</span><span>楼长签收：____________</span></footer></body></html>`;
}

export function printNightStock(order: NightStockRequest) {
  const html = nightStockPrintHtml(order);
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;width:0;height:0;border:0';
  frame.title = '夜宵备货拣货交接单';
  frame.onload = () => {
    const target = frame.contentWindow;
    if (!target) { frame.remove(); return; }
    target.addEventListener('afterprint', () => frame.remove(), { once: true });
    target.focus(); target.print();
  };
  frame.srcdoc = html;
  document.body.appendChild(frame);
}
