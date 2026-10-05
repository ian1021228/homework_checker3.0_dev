/**
 * 總覽大螢幕課堂看板 (Overview / Classroom Mission Control)
 * 專為教室大螢幕/電子白板設計，一目了然，免向下捲動
 * 整合：各作業未交座號速覽、今日聯絡簿、今日值日生、注意事項、出缺席概況
 */

import { state } from './state.js';
import { formatDate, safeCopyToClipboard, showToast, openModal, closeModal } from './utils.js';
import { getTodayDutyStudents } from './officers.js';
import { getTodayAttendanceSummary } from './attendance.js';

export function getTodayDateStr() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

export function formatChineseDateWithWeekday(date = new Date()) {
    const weekdays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
    const y = date.getFullYear();
    const m = date.getMonth() + 1;
    const d = date.getDate();
    const w = weekdays[date.getDay()];
    return `${y} 年 ${m} 月 ${d} 日 ${w}`;
}

export function renderOverviewPage() {
    const currentClass = (state.appData?.classes || []).find(c => c.id === state.currentClassId);
    if (!currentClass) return;

    // 1. 日期與班級顯示
    const dateDisplay = document.getElementById('overview-date-display');
    if (dateDisplay) {
        dateDisplay.textContent = `${currentClass.name} · ${formatChineseDateWithWeekday()}`;
    }

    const todayStr = getTodayDateStr();

    // 2. 作業未繳交座號速覽
    renderOverviewHomeworks(currentClass);

    // 3. 今日出缺席看板
    renderOverviewAttendance(currentClass, todayStr);

    // 4. 今日聯絡簿
    renderOverviewContactBook(currentClass, todayStr);

    // 5. 今日值日生
    renderOverviewDutyStudents(currentClass, todayStr);

    // 6. 班級注意事項
    renderOverviewNotice(currentClass);
}

function renderOverviewHomeworks(currentClass) {
    const container = document.getElementById('overview-homework-list');
    const badge = document.getElementById('overview-hw-missing-badge');
    if (!container) return;

    const classHomeworks = (state.appData?.homeworks || []).filter(h => h.classId === currentClass.id);
    if (classHomeworks.length === 0) {
        container.innerHTML = `
            <div class="h-40 flex flex-col items-center justify-center text-slate-400 font-bold text-sm bg-slate-50/70 rounded-2xl border border-dashed border-slate-200">
                <i class="fa-solid fa-folder-open text-2xl text-slate-300 mb-2"></i>
                <span>目前尚無指派中的作業</span>
            </div>
        `;
        if (badge) badge.textContent = '0 項作業';
        return;
    }

    let totalMissingAcrossAll = 0;

    const cardsHtml = classHomeworks.map(hw => {
        const students = hw.students || [];
        const maxSeat = typeof currentClass.lastMaxSeat === 'number' ? currentClass.lastMaxSeat : students.length;
        
        // 找出未繳交學生
        const missingSeats = [];
        for (let i = 1; i <= maxSeat; i++) {
            const st = students.find(s => Number(s.seat) === i);
            if (!st || st.status !== 'completed') {
                missingSeats.push(i);
            }
        }

        totalMissingAcrossAll += missingSeats.length;
        const turnedInCount = maxSeat - missingSeats.length;
        const rate = maxSeat > 0 ? Math.round((turnedInCount / maxSeat) * 100) : 100;
        const isAllDone = missingSeats.length === 0;

        let missingBadgesHtml = '';
        if (isAllDone) {
            missingBadgesHtml = `
                <span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-emerald-100 text-emerald-800 font-black text-xs">
                    <i class="fa-solid fa-circle-check text-emerald-600"></i> 全班已繳齊
                </span>
            `;
        } else {
            missingBadgesHtml = `
                <div class="flex flex-wrap items-center gap-1.5 mt-1.5">
                    <span class="text-xs font-black text-rose-600 shrink-0 mr-1">未交座號：</span>
                    ${missingSeats.map(seat => `
                        <span class="inline-flex items-center justify-center min-w-[26px] h-6 px-1.5 rounded-lg bg-rose-600 text-white font-black text-xs shadow-xs">
                            ${String(seat).padStart(2, '0')}
                        </span>
                    `).join('')}
                </div>
            `;
        }

        return `
            <div class="p-3.5 rounded-2xl bg-white border border-slate-200/90 shadow-2xs hover:shadow-xs transition-shadow">
                <div class="flex items-center justify-between gap-2 mb-1.5">
                    <div class="flex items-center gap-2 font-black text-slate-900 text-sm truncate">
                        <span class="w-2.5 h-2.5 rounded-full ${isAllDone ? 'bg-emerald-500' : 'bg-rose-500'} shrink-0"></span>
                        <span class="truncate">${hw.name}</span>
                    </div>
                    <div class="flex items-center gap-2 shrink-0">
                        <span class="text-xs font-black font-mono ${isAllDone ? 'text-emerald-600' : 'text-slate-600'}">
                            ${turnedInCount} / ${maxSeat} (${rate}%)
                        </span>
                    </div>
                </div>

                <!-- 進度條 -->
                <div class="w-full bg-slate-100 rounded-full h-2 mb-2 overflow-hidden">
                    <div class="${isAllDone ? 'bg-emerald-500' : 'bg-indigo-600'} h-2 rounded-full transition-all duration-500" style="width: ${rate}%"></div>
                </div>

                <!-- 未交座號標籤 -->
                ${missingBadgesHtml}
            </div>
        `;
    }).join('');

    container.innerHTML = cardsHtml;
    if (badge) {
        badge.innerHTML = totalMissingAcrossAll === 0 
            ? `<span class="text-emerald-600 font-bold"><i class="fa-solid fa-check mr-1"></i>全員全齊</span>`
            : `<span>總缺交人次：<strong class="text-rose-600 font-black">${totalMissingAcrossAll}</strong></span>`;
    }
}

function renderOverviewAttendance(currentClass, todayStr) {
    const summary = getTodayAttendanceSummary(currentClass, todayStr);
    
    const elPresent = document.getElementById('overview-att-present-count');
    const elTardy = document.getElementById('overview-att-tardy-count');
    const elLeave = document.getElementById('overview-att-leave-count');
    const elTotal = document.getElementById('overview-att-total-count');
    const elDetail = document.getElementById('overview-att-detail-box');

    if (elPresent) elPresent.textContent = summary.presentCount;
    if (elTardy) elTardy.textContent = summary.tardyCount;
    if (elLeave) elLeave.textContent = summary.leaveCount;
    if (elTotal) elTotal.textContent = summary.totalStudents;

    if (elDetail) {
        if (summary.tardyCount === 0 && summary.leaveCount === 0) {
            elDetail.innerHTML = `
                <div class="flex items-center gap-2 text-emerald-700 font-bold text-xs">
                    <i class="fa-solid fa-circle-check text-emerald-500"></i>
                    <span>今日全員準時到齊，無遲到缺席學生！</span>
                </div>
            `;
        } else {
            const abnormalItems = [];
            if (summary.tardies.length > 0) {
                abnormalItems.push(`
                    <span class="text-amber-800 font-black">
                        遲到 (${summary.tardyCount}人)：${summary.tardies.map(t => `${String(t.seat).padStart(2, '0')}號 ${t.name || ''}`).join('、')}
                    </span>
                `);
            }
            if (summary.leaves.length > 0) {
                abnormalItems.push(`
                    <span class="text-rose-800 font-black">
                        請假 (${summary.leaveCount}人)：${summary.leaves.map(l => `${String(l.seat).padStart(2, '0')}號 ${l.name || ''} (${l.reason || '假'})`).join('、')}
                    </span>
                `);
            }
            elDetail.innerHTML = `
                <div class="flex flex-col gap-1 w-full text-xs">
                    ${abnormalItems.join('')}
                </div>
            `;
        }
    }
}

function renderOverviewContactBook(currentClass, todayStr) {
    const box = document.getElementById('overview-contact-items-box');
    if (!box) return;

    const contactBook = currentClass.contactBook || {};
    const todayData = contactBook[todayStr] || {};
    const items = todayData.items || [];

    if (items.length === 0) {
        box.innerHTML = `
            <div class="h-32 flex flex-col items-center justify-center text-slate-400 font-mono text-sm opacity-80">
                <i class="fa-solid fa-chalkboard text-2xl mb-1 text-slate-500"></i>
                <span>今日聯絡簿尚未新增條目</span>
                <span class="text-xs text-slate-500 mt-1">點擊右上角「聯絡簿編輯」即可寫上黑板</span>
            </div>
        `;
        return;
    }

    const itemsHtml = items.map((item, index) => {
        const text = typeof item === 'string' ? item : (item.text || '');
        return `
            <div class="flex items-start gap-2.5 py-1.5 border-b border-white/10 last:border-0 leading-relaxed font-mono">
                <span class="text-amber-300 font-black shrink-0">${index + 1}.</span>
                <span class="text-slate-100 flex-1 break-words">${text}</span>
            </div>
        `;
    }).join('');

    box.innerHTML = itemsHtml;
}

function renderOverviewDutyStudents(currentClass, todayStr) {
    const namesEl = document.getElementById('overview-duty-names');
    if (!namesEl) return;

    const duty = getTodayDutyStudents(currentClass, todayStr);
    if (!duty || duty.length === 0) {
        namesEl.textContent = '今日未指定值日生';
        return;
    }

    const namesText = duty.map(d => `${String(d.seat).padStart(2, '0')}號 ${d.name || ''}`).join(' · ');
    namesEl.textContent = namesText;
}

function renderOverviewNotice(currentClass) {
    const noticeEl = document.getElementById('overview-notice-display');
    if (!noticeEl) return;

    const notice = currentClass.bulletinNotice || '';
    if (notice.trim()) {
        noticeEl.innerHTML = `<span class="line-clamp-2">${notice.replace(/\n/g, '<br>')}</span>`;
    } else {
        noticeEl.textContent = '暫無特殊注意事項，請記得攜帶文具、水壺與作業！';
    }
}

/**
 * 一鍵複製今日總通報 (包含作業未交座號、聯絡簿、值日生、出缺席概況、家長端連結)
 */
export function copyOverviewDailyReport() {
    const currentClass = (state.appData?.classes || []).find(c => c.id === state.currentClassId);
    if (!currentClass) {
        showToast('請先選擇班級！', 'warning');
        return;
    }

    const todayStr = getTodayDateStr();
    const dateHeader = formatChineseDateWithWeekday();
    const code = currentClass.accessCode || '';
    const parentUrl = `https://ian1021228.github.io/parent_dashboard_dev/?code=${code}`;

    let report = `📢 【${currentClass.name}】課堂每日總通報\n`;
    report += `📅 日期：${dateHeader}\n\n`;

    // 1. 今日聯絡簿
    const contactBook = currentClass.contactBook || {};
    const todayData = contactBook[todayStr] || {};
    const items = todayData.items || [];
    report += `📝 【今日聯絡事項】\n`;
    if (items.length > 0) {
        items.forEach((it, idx) => {
            const txt = typeof it === 'string' ? it : (it.text || '');
            report += `${idx + 1}. ${txt}\n`;
        });
    } else {
        report += `(今日無特別登記項目)\n`;
    }
    report += `\n`;

    // 2. 作業未交座號
    report += `📋 【作業點收與未交名單】\n`;
    const classHomeworks = (state.appData?.homeworks || []).filter(h => h.classId === currentClass.id);
    if (classHomeworks.length > 0) {
        classHomeworks.forEach(hw => {
            const students = hw.students || [];
            const maxSeat = typeof currentClass.lastMaxSeat === 'number' ? currentClass.lastMaxSeat : students.length;
            const missingSeats = [];
            for (let i = 1; i <= maxSeat; i++) {
                const st = students.find(s => Number(s.seat) === i);
                if (!st || st.status !== 'completed') {
                    missingSeats.push(String(i).padStart(2, '0'));
                }
            }
            if (missingSeats.length === 0) {
                report += `✔ ${hw.name}：全班繳齊！\n`;
            } else {
                report += `✘ ${hw.name}（未交座號）：${missingSeats.join(', ')}\n`;
            }
        });
    } else {
        report += `(目前尚無指派作業)\n`;
    }
    report += `\n`;

    // 3. 值日生
    const duty = getTodayDutyStudents(currentClass, todayStr);
    if (duty && duty.length > 0) {
        report += `🧹 【今日值日生】：${duty.map(d => `${String(d.seat).padStart(2, '0')}號 ${d.name || ''}`).join('、')}\n\n`;
    }

    // 4. 注意事項
    if (currentClass.bulletinNotice && currentClass.bulletinNotice.trim()) {
        report += `💡 【重要提醒】：${currentClass.bulletinNotice.trim()}\n\n`;
    }

    // 5. 家長端直查連結
    report += `🔗 家長端即時查詢與電子簽名：\n${parentUrl}\n`;

    safeCopyToClipboard(report);
    showToast('已複製今日總通報文案至剪貼簿！可直接貼至家長 LINE 官方群組', 'success');
}

/**
 * 全螢幕切換
 */
export function toggleOverviewFullscreen() {
    const el = document.getElementById('overview-page');
    if (!el) return;

    if (!document.fullscreenElement) {
        el.requestFullscreen?.().catch(err => {
            console.warn("Fullscreen request error:", err);
        });
    } else {
        document.exitFullscreen?.().catch(() => {});
    }
}
