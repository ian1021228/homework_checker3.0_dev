/**
 * 幹部及值日生管理模組 (Officers & Daily Duty Rotation)
 * 支援：班級幹部設定、座號每日自動輪值排程、手動指定與調換、工作備忘錄
 */

import { state } from './state.js';
import { saveData } from './storage.js';
import { showToast, openModal, closeModal } from './utils.js';

export const OFFICER_ROLES = [
    { key: 'president', title: '班長', icon: 'fa-crown', color: 'text-amber-600 bg-amber-50 border-amber-200' },
    { key: 'vicePresident', title: '副班長', icon: 'fa-award', color: 'text-orange-600 bg-orange-50 border-orange-200' },
    { key: 'discipline', title: '風紀股長', icon: 'fa-shield-halved', color: 'text-rose-600 bg-rose-50 border-rose-200' },
    { key: 'study', title: '學藝股長', icon: 'fa-pen-nib', color: 'text-indigo-600 bg-indigo-50 border-indigo-200' },
    { key: 'hygiene', title: '衛生股長', icon: 'fa-broom', color: 'text-emerald-600 bg-emerald-50 border-emerald-200' },
    { key: 'sports', title: '體育股長', icon: 'fa-volleyball', color: 'text-blue-600 bg-blue-50 border-blue-200' },
    { key: 'counsel', title: '輔導股長', icon: 'fa-hand-holding-heart', color: 'text-purple-600 bg-purple-50 border-purple-200' },
    { key: 'general', title: '總務股長', icon: 'fa-coins', color: 'text-yellow-600 bg-yellow-50 border-yellow-200' },
    { key: 'library', title: '圖書股長', icon: 'fa-book-bookmark', color: 'text-teal-600 bg-teal-50 border-teal-200' },
    { key: 'info', title: '資訊股長', icon: 'fa-laptop-code', color: 'text-cyan-600 bg-cyan-50 border-cyan-200' },
    { key: 'subjectChinese', title: '國文小老師', icon: 'fa-scroll', color: 'text-red-600 bg-red-50 border-red-200' },
    { key: 'subjectEnglish', title: '英文小老師', icon: 'fa-language', color: 'text-sky-600 bg-sky-50 border-sky-200' },
    { key: 'subjectMath', title: '數學小老師', icon: 'fa-calculator', color: 'text-violet-600 bg-violet-50 border-violet-200' },
    { key: 'subjectScience', title: '自然小老師', icon: 'fa-flask', color: 'text-lime-600 bg-lime-50 border-lime-200' },
    { key: 'subjectSocial', title: '社會小老師', icon: 'fa-earth-americas', color: 'text-amber-700 bg-amber-50 border-amber-300' }
];

export function getTodayDateStr() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

/**
 * 依日期與班級設定計算當日值日生
 */
export function getTodayDutyStudents(currentClass, dateStr = getTodayDateStr()) {
    if (!currentClass) return [];
    
    currentClass.dutySettings = currentClass.dutySettings || {};
    const settings = currentClass.dutySettings;
    const customAssignments = settings.customAssignments || {};

    // 1. 若該日期有老師手動指定的值日生，優先採用手動指定
    if (customAssignments[dateStr] && Array.isArray(customAssignments[dateStr]) && customAssignments[dateStr].length > 0) {
        return customAssignments[dateStr].map(seat => {
            const numSeat = Number(seat);
            const st = (currentClass.students || []).find(s => Number(s.seat) === numSeat);
            return {
                seat: numSeat,
                name: st ? (st.name || `${numSeat}號`) : `${numSeat}號`,
                isCustom: true
            };
        });
    }

    // 2. 自動按日期天數與座號推算輪值
    const maxSeat = typeof currentClass.lastMaxSeat === 'number' && currentClass.lastMaxSeat > 0 
        ? currentClass.lastMaxSeat 
        : ((currentClass.students || []).length || 30);
    const perDay = Number(settings.studentsPerDay) || 2;

    // 用 dateStr 產生確定性的天數序號
    const [y, m, d] = dateStr.split('-').map(Number);
    const targetDate = new Date(y, m - 1, d);
    // 計算從年初至今天的上課天數 (略過週六日)
    const startOfYear = new Date(y, 0, 1);
    let schoolDayCount = 0;
    for (let cur = new Date(startOfYear); cur <= targetDate; cur.setDate(cur.getDate() + 1)) {
        const dayOfWeek = cur.getDay();
        if (dayOfWeek !== 0 && dayOfWeek !== 6) { // 排除週六週日
            schoolDayCount++;
        }
    }

    const startIndex = (schoolDayCount * perDay) % maxSeat;
    const result = [];
    for (let i = 0; i < perDay; i++) {
        let seatNum = ((startIndex + i) % maxSeat) + 1;
        const st = (currentClass.students || []).find(s => Number(s.seat) === seatNum);
        result.push({
            seat: seatNum,
            name: st ? (st.name || `${seatNum}號`) : `${seatNum}號`,
            isCustom: false
        });
    }

    return result;
}

export function renderOfficersPage() {
    const currentClass = (state.appData?.classes || []).find(c => c.id === state.currentClassId);
    if (!currentClass) return;

    currentClass.officers = currentClass.officers || {};
    currentClass.dutySettings = currentClass.dutySettings || {
        studentsPerDay: 2,
        cycleMode: 'sequential',
        customAssignments: {}
    };

    const maxSeat = typeof currentClass.lastMaxSeat === 'number' ? currentClass.lastMaxSeat : 30;

    // 1. 渲染 15 大幹部卡片
    const grid = document.getElementById('officers-grid');
    if (grid) {
        grid.innerHTML = OFFICER_ROLES.map(role => {
            const savedSeat = currentClass.officers[role.key]?.seat || '';
            const savedName = currentClass.officers[role.key]?.name || '';

            return `
                <div class="p-4 rounded-2xl border ${role.color} flex flex-col justify-between transition-all hover:shadow-xs">
                    <div class="flex items-center justify-between mb-2">
                        <div class="flex items-center gap-2 font-black text-sm text-slate-800">
                            <i class="fa-solid ${role.icon} text-base"></i>
                            <span>${role.title}</span>
                        </div>
                    </div>
                    <div class="space-y-1.5">
                        <div class="flex items-center gap-2">
                            <label class="text-[11px] font-bold text-slate-500 shrink-0">座號</label>
                            <input 
                                type="number" 
                                min="1" 
                                max="${maxSeat}" 
                                placeholder="座號" 
                                value="${savedSeat}" 
                                data-role="${role.key}"
                                class="officer-seat-input w-20 py-1 px-2 rounded-lg border border-slate-300 text-xs font-bold text-center bg-white text-slate-900 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                            />
                            <input 
                                type="text" 
                                placeholder="姓名" 
                                value="${savedName}" 
                                data-role="${role.key}"
                                class="officer-name-input flex-1 py-1 px-2 rounded-lg border border-slate-300 text-xs font-bold bg-white text-slate-900 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                            />
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        // 綁定輸入時自動查填姓名
        grid.querySelectorAll('.officer-seat-input').forEach(input => {
            input.addEventListener('change', (e) => {
                const seatVal = Number(e.target.value);
                const roleKey = e.target.dataset.role;
                const nameInput = grid.querySelector(`.officer-name-input[data-role="${roleKey}"]`);
                if (seatVal && nameInput) {
                    const st = (currentClass.students || []).find(s => Number(s.seat) === seatVal);
                    if (st && st.name) {
                        nameInput.value = st.name;
                    }
                }
            });
        });
    }

    // 2. 渲染今日值日生與參數
    renderDutySettingsSection(currentClass);
}

function renderDutySettingsSection(currentClass) {
    const todayStr = getTodayDateStr();
    const dutyTodayDate = document.getElementById('duty-today-date');
    if (dutyTodayDate) dutyTodayDate.textContent = todayStr;

    const dutyBox = document.getElementById('duty-today-students-box');
    if (dutyBox) {
        const duty = getTodayDutyStudents(currentClass, todayStr);
        dutyBox.innerHTML = duty.map(d => `
            <span class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-600 text-white font-black text-sm shadow-xs">
                <i class="fa-solid fa-broom text-amber-200 text-xs"></i>
                <span>${String(d.seat).padStart(2, '0')}號 ${d.name}</span>
                ${d.isCustom ? '<span class="text-[10px] bg-white/20 px-1 rounded">手動</span>' : ''}
            </span>
        `).join('');
    }

    const perDaySelect = document.getElementById('duty-students-per-day');
    if (perDaySelect && currentClass.dutySettings?.studentsPerDay) {
        perDaySelect.value = String(currentClass.dutySettings.studentsPerDay);
    }
}

/**
 * 儲存幹部設定與值日生排程
 */
export function saveOfficersAndDutySettings() {
    const currentClass = (state.appData?.classes || []).find(c => c.id === state.currentClassId);
    if (!currentClass) return;

    currentClass.officers = currentClass.officers || {};

    // 收集幹部輸入
    OFFICER_ROLES.forEach(role => {
        const seatInput = document.querySelector(`.officer-seat-input[data-role="${role.key}"]`);
        const nameInput = document.querySelector(`.officer-name-input[data-role="${role.key}"]`);
        const seat = seatInput ? (Number(seatInput.value) || '') : '';
        const name = nameInput ? nameInput.value.trim() : '';

        currentClass.officers[role.key] = { seat, name };
    });

    // 收集值日生設定
    currentClass.dutySettings = currentClass.dutySettings || {};
    const perDaySelect = document.getElementById('duty-students-per-day');
    if (perDaySelect) {
        currentClass.dutySettings.studentsPerDay = Number(perDaySelect.value) || 2;
    }

    const tasksInput = document.getElementById('duty-tasks-input');
    if (tasksInput) {
        currentClass.dutySettings.tasks = tasksInput.value.trim();
    }

    saveData();
    showToast('班級幹部與值日生設定已成功儲存並同步至雲端！', 'success');
    renderDutySettingsSection(currentClass);
}

/**
 * 手動為指定日期指派/更換值日生
 */
export function setCustomDutyForDate(dateStr, seatsArray) {
    const currentClass = (state.appData?.classes || []).find(c => c.id === state.currentClassId);
    if (!currentClass) return;

    currentClass.dutySettings = currentClass.dutySettings || {};
    currentClass.dutySettings.customAssignments = currentClass.dutySettings.customAssignments || {};
    currentClass.dutySettings.customAssignments[dateStr] = seatsArray.map(Number).filter(Boolean);

    saveData();
    showToast(`已成功指定 ${dateStr} 的值日生為：${seatsArray.join(', ')} 號`, 'success');
    renderDutySettingsSection(currentClass);
}
