/**
 * 簽到及遲到點名模組 (Attendance & Tardy Management)
 * 支援：一鍵點名、座號一鍵循環切換出席/遲到/病假/事假/公假、出勤統計、LINE通報、CSV匯出
 */

import { state } from './state.js';
import { saveData } from './storage.js';
import { showToast, safeCopyToClipboard } from './utils.js';

export const ATTENDANCE_STATUSES = [
    { key: 'present', label: '出席', bg: 'bg-emerald-500', text: 'text-emerald-700', border: 'border-emerald-300', lightBg: 'bg-emerald-50' },
    { key: 'tardy', label: '遲到', bg: 'bg-amber-500', text: 'text-amber-700', border: 'border-amber-300', lightBg: 'bg-amber-50' },
    { key: 'sick', label: '病假', bg: 'bg-rose-500', text: 'text-rose-700', border: 'border-rose-300', lightBg: 'bg-rose-50' },
    { key: 'personal', label: '事假', bg: 'bg-blue-500', text: 'text-blue-700', border: 'border-blue-300', lightBg: 'bg-blue-50' },
    { key: 'official', label: '公假', bg: 'bg-purple-500', text: 'text-purple-700', border: 'border-purple-300', lightBg: 'bg-purple-50' }
];

export function getTodayDateStr() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

export function getTodayAttendanceSummary(currentClass, dateStr = getTodayDateStr()) {
    if (!currentClass) {
        return { presentCount: 0, tardyCount: 0, leaveCount: 0, totalStudents: 0, tardies: [], leaves: [] };
    }

    const maxSeat = typeof currentClass.lastMaxSeat === 'number' && currentClass.lastMaxSeat > 0 
        ? currentClass.lastMaxSeat 
        : ((currentClass.students || []).length || 30);
    const attRecord = currentClass.attendance?.[dateStr] || {};

    let presentCount = 0;
    let tardyCount = 0;
    let leaveCount = 0;
    const tardies = [];
    const leaves = [];

    for (let s = 1; s <= maxSeat; s++) {
        const studentInfo = (currentClass.students || []).find(st => Number(st.seat) === s);
        const name = studentInfo ? studentInfo.name : `${s}號`;
        const seatData = attRecord[s];
        const status = seatData?.status || 'present'; // 預設皆為出席

        if (status === 'present') {
            presentCount++;
        } else if (status === 'tardy') {
            tardyCount++;
            tardies.push({ seat: s, name, time: seatData?.time || '' });
        } else {
            leaveCount++;
            leaves.push({ seat: s, name, reason: seatData?.note || status });
        }
    }

    return {
        presentCount,
        tardyCount,
        leaveCount,
        totalStudents: maxSeat,
        tardies,
        leaves
    };
}

let activeAttendanceDate = getTodayDateStr();

export function renderAttendancePage(dateStr = activeAttendanceDate) {
    activeAttendanceDate = dateStr;
    const currentClass = (state.appData?.classes || []).find(c => c.id === state.currentClassId);
    if (!currentClass) return;

    // 日期選擇器同步
    const dateInput = document.getElementById('attendance-date-input');
    if (dateInput) {
        dateInput.value = dateStr;
    }

    currentClass.attendance = currentClass.attendance || {};
    currentClass.attendance[dateStr] = currentClass.attendance[dateStr] || {};
    const dateRecord = currentClass.attendance[dateStr];

    const maxSeat = typeof currentClass.lastMaxSeat === 'number' ? currentClass.lastMaxSeat : 30;

    // 1. 計算並更新統計條
    let cntPresent = 0, cntTardy = 0, cntSick = 0, cntPersonal = 0, cntOfficial = 0;
    for (let s = 1; s <= maxSeat; s++) {
        const st = dateRecord[s]?.status || 'present';
        if (st === 'present') cntPresent++;
        else if (st === 'tardy') cntTardy++;
        else if (st === 'sick') cntSick++;
        else if (st === 'personal') cntPersonal++;
        else if (st === 'official') cntOfficial++;
    }

    const statPres = document.getElementById('stat-att-present');
    const statTar = document.getElementById('stat-att-tardy');
    const statSick = document.getElementById('stat-att-sick');
    const statPer = document.getElementById('stat-att-personal');
    const statOff = document.getElementById('stat-att-official');

    if (statPres) statPres.textContent = cntPresent;
    if (statTar) statTar.textContent = cntTardy;
    if (statSick) statSick.textContent = cntSick;
    if (statPer) statPer.textContent = cntPersonal;
    if (statOff) statOff.textContent = cntOfficial;

    // 2. 渲染學生座號點名卡片矩陣
    const grid = document.getElementById('attendance-students-grid');
    if (!grid) return;

    const cardsHtml = [];
    for (let s = 1; s <= maxSeat; s++) {
        const studentInfo = (currentClass.students || []).find(st => Number(st.seat) === s);
        const name = studentInfo ? studentInfo.name : `${s}號`;
        const seatData = dateRecord[s] || { status: 'present' };
        const statusConfig = ATTENDANCE_STATUSES.find(st => st.key === seatData.status) || ATTENDANCE_STATUSES[0];

        cardsHtml.push(`
            <div 
                class="attendance-seat-card p-3 rounded-2xl border ${statusConfig.border} ${statusConfig.lightBg} flex flex-col justify-between cursor-pointer transition-all hover:scale-[1.02] active:scale-95 shadow-2xs select-none"
                data-seat="${s}"
                data-current-status="${statusConfig.key}"
                title="點擊切換下一個出勤狀態"
            >
                <div class="flex items-center justify-between">
                    <span class="text-xs font-black font-mono px-2 py-0.5 rounded-lg bg-white/80 text-slate-800 shadow-2xs">
                        ${String(s).padStart(2, '0')}
                    </span>
                    <span class="inline-flex items-center gap-1 text-xs font-black px-2 py-0.5 rounded-lg ${statusConfig.bg} text-white shadow-2xs">
                        ${statusConfig.label}
                    </span>
                </div>
                <div class="mt-2 text-center">
                    <div class="font-black text-sm text-slate-900 truncate">${name}</div>
                    ${seatData.time ? `<div class="text-[10px] text-amber-700 font-bold mt-0.5">${seatData.time} 到校</div>` : ''}
                </div>
            </div>
        `);
    }

    grid.innerHTML = cardsHtml.join('');

    // 綁定點擊循環切換狀態
    grid.querySelectorAll('.attendance-seat-card').forEach(card => {
        card.addEventListener('click', () => {
            const seat = Number(card.dataset.seat);
            cycleStudentAttendance(seat, activeAttendanceDate);
        });
    });
}

/**
 * 循環切換學生出勤狀態
 */
export function cycleStudentAttendance(seat, dateStr = activeAttendanceDate) {
    const currentClass = (state.appData?.classes || []).find(c => c.id === state.currentClassId);
    if (!currentClass) return;

    currentClass.attendance = currentClass.attendance || {};
    currentClass.attendance[dateStr] = currentClass.attendance[dateStr] || {};
    
    const curStatus = currentClass.attendance[dateStr][seat]?.status || 'present';
    const statusOrder = ['present', 'tardy', 'sick', 'personal', 'official'];
    const curIdx = statusOrder.indexOf(curStatus);
    const nextStatus = statusOrder[(curIdx + 1) % statusOrder.length];

    currentClass.attendance[dateStr][seat] = {
        status: nextStatus,
        time: nextStatus === 'tardy' ? new Date().toTimeString().slice(0, 5) : '',
        updatedAt: new Date().toISOString()
    };

    saveData();
    renderAttendancePage(dateStr);
}

/**
 * 一鍵全員出席
 */
export function markAllPresent(dateStr = activeAttendanceDate) {
    const currentClass = (state.appData?.classes || []).find(c => c.id === state.currentClassId);
    if (!currentClass) return;

    currentClass.attendance = currentClass.attendance || {};
    currentClass.attendance[dateStr] = {};

    const maxSeat = typeof currentClass.lastMaxSeat === 'number' ? currentClass.lastMaxSeat : 30;
    for (let s = 1; s <= maxSeat; s++) {
        currentClass.attendance[dateStr][s] = {
            status: 'present',
            updatedAt: new Date().toISOString()
        };
    }

    saveData();
    showToast(`已將 ${dateStr} 全班設為全員出席！`, 'success');
    renderAttendancePage(dateStr);
}

/**
 * 一鍵複製出勤通報
 */
export function copyAttendanceLineReport(dateStr = activeAttendanceDate) {
    const currentClass = (state.appData?.classes || []).find(c => c.id === state.currentClassId);
    if (!currentClass) return;

    const summary = getTodayAttendanceSummary(currentClass, dateStr);

    let msg = `📋 【${currentClass.name}】點名通報 (${dateStr})\n`;
    msg += `👥 應到：${summary.totalStudents} 人，實到：${summary.presentCount} 人\n`;

    if (summary.tardyCount > 0) {
        msg += `⏰ 遲到 (${summary.tardyCount}人)：${summary.tardies.map(t => `${String(t.seat).padStart(2, '0')}號 ${t.name || ''}`).join('、')}\n`;
    }
    if (summary.leaveCount > 0) {
        msg += `🏥 請假 (${summary.leaveCount}人)：${summary.leaves.map(l => `${String(l.seat).padStart(2, '0')}號 ${l.name || ''}`).join('、')}\n`;
    }
    if (summary.tardyCount === 0 && summary.leaveCount === 0) {
        msg += `✨ 全員準時出席，無人缺席或遲到！\n`;
    }

    safeCopyToClipboard(msg);
    showToast('已複製出勤通報文案！可直接傳送給學務處或家長群', 'success');
}

/**
 * 匯出出勤紀錄為 CSV
 */
export function exportAttendanceCsv(dateStr = activeAttendanceDate) {
    const currentClass = (state.appData?.classes || []).find(c => c.id === state.currentClassId);
    if (!currentClass) return;

    const maxSeat = typeof currentClass.lastMaxSeat === 'number' ? currentClass.lastMaxSeat : 30;
    const dateRecord = currentClass.attendance?.[dateStr] || {};

    let csvContent = "\uFEFF座號,姓名,出勤狀態,到校時間,備註\n";
    for (let s = 1; s <= maxSeat; s++) {
        const studentInfo = (currentClass.students || []).find(st => Number(st.seat) === s);
        const name = studentInfo ? studentInfo.name : `${s}號`;
        const seatData = dateRecord[s] || { status: 'present' };
        const statusConfig = ATTENDANCE_STATUSES.find(st => st.key === seatData.status) || ATTENDANCE_STATUSES[0];

        csvContent += `"${s}","${name}","${statusConfig.label}","${seatData.time || ''}","${seatData.note || ''}"\n`;
    }

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `${currentClass.name}_出勤表_${dateStr}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast('已匯出出勤紀錄 CSV 檔案！', 'success');
}
