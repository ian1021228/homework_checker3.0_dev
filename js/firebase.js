import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { 
    getAuth, 
    signInWithPopup, 
    getRedirectResult, 
    GoogleAuthProvider, 
    onAuthStateChanged, 
    signOut, 
    signInWithEmailAndPassword, 
    createUserWithEmailAndPassword, 
    sendPasswordResetEmail, 
    sendEmailVerification,
    reload,
    applyActionCode,
    updateProfile, 
    updatePassword,
    signInAnonymously 
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { 
    getFirestore, 
    initializeFirestore, 
    persistentLocalCache, 
    persistentMultipleTabManager, 
    doc, 
    setDoc, 
    getDoc, 
    collection, 
    query,
    where,
    getDocs, 
    onSnapshot, 
    updateDoc, 
    deleteDoc 
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

import { firebaseConfig, globalAppId, DEFAULT_TYPES } from './constants.js';
import { state } from './state.js';
import { safeStringify, safeClone, sanitizeAppData, fixDates, showToast, showAlertModal, showConfirmModal, closeModal } from './utils.js';
import { getUserStorageKey, loadLocalDataForUser } from './storage.js';

export let fbApp, fbAuth, fbDb;

export {
    globalAppId,
    signInWithPopup, 
    GoogleAuthProvider, 
    signInWithEmailAndPassword, 
    createUserWithEmailAndPassword, 
    updateProfile, 
    signOut, 
    signInAnonymously,
    sendPasswordResetEmail, 
    sendEmailVerification,
    reload,
    applyActionCode,
    doc, 
    setDoc, 
    getDoc, 
    collection, 
    query,
    where,
    getDocs, 
    onSnapshot, 
    updateDoc, 
    deleteDoc 
};

try {
    fbApp = initializeApp(firebaseConfig);
    fbAuth = getAuth(fbApp);
    // 設定 Firebase Auth 語系為繁體中文，確保所有寄送之信件皆以繁體中文發送
    fbAuth.languageCode = 'zh-TW';
    
    fbDb = initializeFirestore(fbApp, {
        localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
    });
} catch (err) {
    console.warn("Firebase 初始化失敗:", err);
}

if (fbAuth) {
    onAuthStateChanged(fbAuth, (user) => {
        try {
            const syncStatus = document.getElementById('cloud-sync-status');
            const loginBtn = document.getElementById('google-login-btn');
            const cloudActions = document.getElementById('cloud-actions');
            const storageContainer = document.getElementById('cloud-storage-container');

            if (user) {
                if (syncStatus) {
                    syncStatus.innerHTML = `狀態：跨裝置即時同步中 <br><span class="text-sky-900 font-bold bg-white px-3 py-1.5 rounded-xl inline-block mt-2 shadow-sm border border-sky-100 text-[11px] tracking-wide"><i class="fa-solid fa-user mr-1 text-sky-600"></i> ${user.displayName || user.email}</span>`;
                }
                if (loginBtn) loginBtn.classList.add('hidden');
                if (cloudActions) cloudActions.classList.remove('hidden');
                if (storageContainer) storageContainer.classList.remove('hidden');
                syncUserProfile();
                if (sessionStorage.getItem('app_is_guest_mode') !== 'true' && !state.adminViewModeUserId) {
                    startRealtimeCloudSync();
                }
            } else {
                const isGuest = sessionStorage.getItem('app_is_guest_mode') === 'true';
                const isQrAuth = Boolean(state.currentUser?.isQrAuthorized || sessionStorage.getItem('qr_authorized_session'));
                const isGoogle = isGoogleAuthUser(state.currentUser) || sessionStorage.getItem('auth_provider') === 'google';

                if (state.currentUser && !isGuest) {
                    let badgeText = '<i class="fa-solid fa-circle-check text-emerald-500 mr-1.5"></i>雲端同步已連線';
                    if (isGoogle) {
                        badgeText = '<i class="fa-solid fa-circle-check text-emerald-500 mr-1.5"></i>雲端同步已連線 (Google 授權)';
                    } else if (state.currentUser.schoolName) {
                        badgeText = `<i class="fa-solid fa-circle-check text-emerald-500 mr-1.5"></i>雲端同步已連線 (${state.currentUser.schoolName})`;
                    } else {
                        badgeText = '<i class="fa-solid fa-circle-check text-emerald-500 mr-1.5"></i>雲端同步已連線 (校園帳號)';
                    }
                    const userDisplayTitle = state.currentUser.displayName || state.currentUser.username || state.currentUser.email || '已授權教師';
                    if (syncStatus) {
                        syncStatus.innerHTML = `狀態：${badgeText} <br><span class="text-sky-900 font-bold bg-white px-3 py-1.5 rounded-xl inline-block mt-2 shadow-sm border border-sky-100 text-[11px] tracking-wide"><i class="fa-solid fa-user-check mr-1 text-sky-600"></i> ${userDisplayTitle}</span>`;
                    }
                    if (loginBtn) loginBtn.classList.add('hidden');
                    if (cloudActions) cloudActions.classList.remove('hidden');
                    if (storageContainer) storageContainer.classList.remove('hidden');
                    if (!state.adminViewModeUserId) {
                        startRealtimeCloudSync();
                    }
                } else if (state.currentUser && isGuest) {
                    stopRealtimeCloudSync();
                    if (syncStatus) {
                        syncStatus.innerHTML = `狀態：訪客體驗模式 (資料暫存於此瀏覽器) <br><span class="text-slate-700 font-bold bg-white px-3 py-1.5 rounded-xl inline-block mt-2 shadow-sm border border-slate-200 text-[11px] tracking-wide"><i class="fa-solid fa-user-clock mr-1 text-amber-500"></i> 訪客帳號</span><br><span class="text-[11px] text-sky-600 mt-1 inline-block">建議登入學校指派帳號或 Google 帳號以啟用即時雲端備份</span>`;
                    }
                    if (loginBtn) loginBtn.classList.remove('hidden');
                    if (cloudActions) cloudActions.classList.add('hidden');
                    if (storageContainer) storageContainer.classList.add('hidden');
                } else {
                    stopRealtimeCloudSync();
                    if (syncStatus) {
                        syncStatus.innerHTML = "狀態：未登入，請登入校園派發帳號以啟用雲端同步。";
                    }
                    if (loginBtn) loginBtn.classList.remove('hidden');
                    if (cloudActions) cloudActions.classList.add('hidden');
                    if (storageContainer) storageContainer.classList.add('hidden');
                }
            }
        } catch(e) {}
    });
}

export function isGoogleAuthUser(user) {
    if (!user) return false;
    if (user.isGoogleAuth === true) return true;
    if (sessionStorage.getItem('auth_provider') === 'google') return true;
    if (Array.isArray(user.providerData) && user.providerData.some(p => p && p.providerId === 'google.com')) return true;
    return false;
}

export function isGoogleAdmin(user) {
    if (state?.isDevMode || sessionStorage.getItem('app_dev_mode') === 'true') {
        return true;
    }
    if (!user || !user.email) return false;
    if (user.email.toLowerCase() !== 'ianw.solar@gmail.com') return false;
    return isGoogleAuthUser(user);
}

window.isGoogleAuthUser = isGoogleAuthUser;
window.isGoogleAdmin = isGoogleAdmin;

export function listenToServerConfig() {
    if (!fbDb) return;
    if (state.unsubServerConfig) state.unsubServerConfig();
    
    const configRef = doc(fbDb, 'artifacts', globalAppId, 'public', 'data', 'serverConfig', 'main');
    state.unsubServerConfig = onSnapshot(configRef, (docSnap) => {
        const maintenanceScreen = document.getElementById('system-maintenance-screen');
        const newVersionBtn = document.getElementById('new-version-btn');
        const maintenanceMsg = document.getElementById('maintenance-msg');
        const isAdmin = isGoogleAdmin(state.currentUser);

        if (docSnap.exists()) {
            const data = docSnap.data();
            if (data.isMaintenance && !isAdmin) {
                if (maintenanceScreen) maintenanceScreen.classList.remove('hidden');
                if (maintenanceMsg) maintenanceMsg.textContent = data.maintenanceMessage || '系統目前正在進行維護升級，請稍後再試。';
                
                if (data.showNewVersionLink && data.newVersionUrl) {
                    newVersionBtn?.classList.remove('hidden');
                    if (newVersionBtn) newVersionBtn.onclick = () => window.location.href = data.newVersionUrl;
                } else {
                    newVersionBtn?.classList.add('hidden');
                }
            } else {
                if (maintenanceScreen) maintenanceScreen.classList.add('hidden');
            }
        } else {
            if (maintenanceScreen) maintenanceScreen.classList.add('hidden');
        }
    }, (error) => {
        const maintenanceScreen = document.getElementById('system-maintenance-screen');
        if (maintenanceScreen) maintenanceScreen.classList.add('hidden');
    });
}

export function listenToProfile() {
    if (!fbDb || !fbAuth?.currentUser) return;
    const uid = fbAuth.currentUser.uid;
    if (!uid) return;
    if (state.unsubProfile) state.unsubProfile();
    const userProfileRef = doc(fbDb, 'artifacts', globalAppId, 'public', 'data', 'userProfiles', uid);
    state.unsubProfile = onSnapshot(userProfileRef, (docSnap) => {
        if (docSnap.exists()) {
            const data = docSnap.data();
            const isAdmin = isGoogleAdmin(state.currentUser);
            
            const lockScreen = document.getElementById('system-lock-screen');
            if (data.isLocked && !isAdmin) {
                if (lockScreen) lockScreen.classList.remove('hidden');
            } else {
                if (lockScreen) lockScreen.classList.add('hidden');
            }

            if (data.bannerActive && data.bannerMessage && data.bannerId) {
                state.personalBanner = {
                    id: data.bannerId,
                    message: data.bannerMessage,
                    createdAt: data.bannerTime || new Date().toISOString()
                };
                window.updateBellBadge?.();
                if (state.isBellOpen) window.renderBroadcastPanel?.();

                const dismissed = localStorage.getItem('dismissed_banner_' + data.bannerId);
                if (!dismissed) {
                    const banner = document.getElementById('system-banner');
                    const bannerMsgSpan = document.querySelector('#system-banner-msg span');
                    if (bannerMsgSpan) bannerMsgSpan.textContent = "系統公告：" + data.bannerMessage;
                    banner?.classList.remove('hidden');
                    banner?.classList.add('flex');
                    const bannerClose = document.getElementById('system-banner-close');
                    if (bannerClose) {
                        bannerClose.onclick = () => {
                            banner?.classList.add('hidden');
                            banner?.classList.remove('flex');
                            localStorage.setItem('dismissed_banner_' + data.bannerId, 'true');
                        };
                    }
                }
            }

            if (data.forceReset) {
                performRemoteReset();
            }
        }
    }, (error) => {
        console.warn("Profile listen notice:", error.message || error);
    });
}

export async function syncUserProfile() {
    if (!fbDb || !fbAuth?.currentUser || sessionStorage.getItem('app_is_guest_mode') === 'true') return;
    try {
        const fullBytes = new Blob([safeStringify(state.appData)]).size;
        const currentDataSizeKB = (fullBytes / 1024).toFixed(1);
        const uid = fbAuth.currentUser.uid;
        
        const userProfileRef = doc(fbDb, 'artifacts', globalAppId, 'public', 'data', 'userProfiles', uid);
        await setDoc(userProfileRef, {
            email: state.currentUser?.email || fbAuth.currentUser.email || '',
            displayName: state.currentUser?.displayName || fbAuth.currentUser.displayName || fbAuth.currentUser.email || '使用者',
            isGuest: false,
            lastActive: new Date().toISOString(),
            dataSizeKB: currentDataSizeKB
        }, { merge: true });
        
        let visitorId = localStorage.getItem('visitor_id');
        if (visitorId) {
            try { 
                await deleteDoc(doc(fbDb, 'artifacts', globalAppId, 'public', 'data', 'userProfiles', visitorId)); 
            } catch(e) {}
            localStorage.removeItem('visitor_id');
            localStorage.removeItem('visitor_name');
        }
    } catch(err) {
        console.warn("syncUserProfile notice:", err.message || err);
    }
}

export async function performRemoteReset() {
    state.appData = { classes: [], homeworks: [], homeworkTypes: JSON.parse(safeStringify(DEFAULT_TYPES)) };
    localStorage.setItem('homeworkAppData', safeStringify(state.appData));
    
    if (fbDb) {
        const uid = state.currentUser ? state.currentUser.uid : localStorage.getItem('visitor_id');
        if (uid) {
            try {
                if (state.currentUser) {
                    const docRef = doc(fbDb, 'artifacts', globalAppId, 'users', uid, 'appData', 'mainDoc');
                    await setDoc(docRef, { data: safeStringify(state.appData), updatedAt: new Date().toISOString() });
                }
                const userProfileRef = doc(fbDb, 'artifacts', globalAppId, 'public', 'data', 'userProfiles', uid);
                await updateDoc(userProfileRef, { forceReset: false }); 
            } catch (err) {
                console.error("執行 Firebase 狀態重置時發生錯誤", err);
            }
        }
    }
    
    const lockScreen = document.getElementById('system-lock-screen');
    if (lockScreen) {
        lockScreen.innerHTML = `<div class="text-6xl mb-6 text-rose-500"><i class="fa-solid fa-triangle-exclamation"></i></div><h1 class="text-3xl font-black text-white mb-4">資料已重置</h1><p class="text-slate-300 font-medium">系統已完成資料強制重置作業。</p>`;
        lockScreen.classList.remove('hidden');
    }
    setTimeout(() => window.location.reload(), 2000);
}

export async function loadServerConfigForAdmin() {
    if (!fbDb || !isGoogleAdmin(state.currentUser)) return;
    try {
        const configRef = doc(fbDb, 'artifacts', globalAppId, 'public', 'data', 'serverConfig', 'main');
        const docSnap = await getDoc(configRef);
        if (docSnap.exists()) {
            const data = docSnap.data();
            const maintToggle = document.getElementById('admin-maintenance-toggle');
            const maintMsg = document.getElementById('admin-maintenance-msg');
            const showLinkToggle = document.getElementById('admin-show-link-toggle');
            const newVerUrl = document.getElementById('admin-new-version-url');
            if (maintToggle) maintToggle.checked = data.isMaintenance || false;
            if (maintMsg) maintMsg.value = data.maintenanceMessage || '';
            if (showLinkToggle) showLinkToggle.checked = data.showNewVersionLink || false;
            if (newVerUrl) newVerUrl.value = data.newVersionUrl || '';
        }
    } catch(e) { console.error("Load config error", e); }
}

let adminCachedUsers = [];
let adminUsersCallback = null;
let adminFilterListenersBound = false;

function setupAdminFilterListeners() {
    if (adminFilterListenersBound) return;
    adminFilterListenersBound = true;

    const searchInput = document.getElementById('admin-user-search-input');
    const hideGuestsCb = document.getElementById('admin-hide-guests-checkbox');
    const hideAdminCb = document.getElementById('admin-hide-admin-checkbox');
    const refreshBtn = document.getElementById('admin-refresh-users-btn');

    if (searchInput) {
        searchInput.addEventListener('input', () => renderAdminUsersList());
    }
    if (hideGuestsCb) {
        hideGuestsCb.addEventListener('change', () => renderAdminUsersList());
    }
    if (hideAdminCb) {
        hideAdminCb.addEventListener('change', () => renderAdminUsersList());
    }
    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => loadAllUsersForAdmin(adminUsersCallback));
    }
}

export function renderAdminUsersList() {
    const usersList = document.getElementById('admin-users-list');
    if (!usersList) return;

    const searchInput = document.getElementById('admin-user-search-input');
    const hideGuestsCb = document.getElementById('admin-hide-guests-checkbox');
    const hideAdminCb = document.getElementById('admin-hide-admin-checkbox');
    const countBadge = document.getElementById('admin-user-count-badge');

    const keyword = (searchInput?.value || '').trim().toLowerCase();
    const hideGuests = Boolean(hideGuestsCb?.checked);
    const hideAdmin = Boolean(hideAdminCb?.checked);

    const filtered = adminCachedUsers.filter(u => {
        // 隱藏訪客帳號
        if (hideGuests && u.isGuest) return false;
        // 隱藏管理者帳號 (ianw.solar@gmail.com)
        if (hideAdmin && (u.isAdmin || (u.email && u.email.toLowerCase() === 'ianw.solar@gmail.com'))) return false;
        // 關鍵字搜尋 (支援姓名、Email、稱謂、UID)
        if (keyword) {
            const matchName = (u.displayName || '').toLowerCase().includes(keyword);
            const matchEmail = (u.email || '').toLowerCase().includes(keyword);
            const matchId = (u.id || '').toLowerCase().includes(keyword);
            if (!matchName && !matchEmail && !matchId) return false;
        }
        return true;
    });

    if (countBadge) {
        countBadge.textContent = `顯示 ${filtered.length} / 共 ${adminCachedUsers.length} 個帳號`;
    }

    usersList.innerHTML = '';

    if (filtered.length === 0) {
        usersList.innerHTML = '<tr><td colspan="5" class="text-center p-8 text-slate-400 font-bold"><i class="fa-solid fa-magnifying-glass mr-1"></i> 查無符合條件的用戶資料。</td></tr>';
        return;
    }

    filtered.forEach(u => {
        const data = u.data || {};
        const id = u.id;
        const isAdminUser = u.isAdmin;
        const isLocked = u.isLocked;
        const statusHtml = isLocked 
            ? '<span class="bg-rose-100 text-rose-600 px-2 py-1 rounded-lg text-xs font-black shadow-sm flex items-center gap-1"><i class="fa-solid fa-ban"></i> 已凍結</span>'
            : '<span class="bg-emerald-100 text-emerald-600 px-2 py-1 rounded-lg text-xs font-black shadow-sm flex items-center gap-1"><i class="fa-solid fa-circle-check"></i> 正常</span>';
            
        const lastActive = data.lastActive ? new Date(data.lastActive).toLocaleString('zh-TW', { month: 'short', day: 'numeric', hour: '2-digit', minute:'2-digit'}) : '未知';
        const size = data.dataSizeKB ? `${data.dataSizeKB} KB` : '未知';

        const roleBadge = isAdminUser
            ? '<span class="inline-block bg-amber-100 text-amber-800 text-[10px] font-black px-1.5 py-0.5 rounded-md ml-1.5 align-middle">系統管理員</span>'
            : (u.isGuest ? '<span class="inline-block bg-slate-200 text-slate-600 text-[10px] font-bold px-1.5 py-0.5 rounded-md ml-1.5 align-middle">訪客</span>' : '');

        const tr = document.createElement('tr');
        tr.className = "hover:bg-slate-50/80 transition-colors";
        tr.innerHTML = `
            <td class="p-3 border-b border-slate-100">
                <div class="font-black text-slate-800 text-base flex items-center">
                    <span>${u.displayName}</span>
                    ${roleBadge}
                </div>
                <div class="text-[11px] font-bold text-slate-400 mt-0.5">${u.email || (u.isGuest ? '未綁定 Email (訪客體驗)' : '無 Email')}</div>
            </td>
            <td class="p-3 border-b border-slate-100 text-xs font-bold text-slate-500 hidden sm:table-cell">${lastActive}</td>
            <td class="p-3 border-b border-slate-100 text-xs font-black text-indigo-600">${size}</td>
            <td class="p-3 border-b border-slate-100">${statusHtml}</td>
            <td class="p-3 border-b border-slate-100 text-right space-x-1 whitespace-nowrap">
                ${isAdminUser ? 
                    '<span class="text-xs font-bold text-slate-400 px-2 py-1 mr-2 flex items-center gap-1"><i class="fa-solid fa-shield-halved text-indigo-500"></i> 系統管理權限</span>' : 
                    `<button class="bg-slate-100 hover:bg-slate-200 text-slate-600 px-2.5 py-1.5 rounded-lg text-[11px] font-bold transition-colors toggle-lock-btn shadow-sm cursor-pointer" data-id="${id}" data-locked="${isLocked}">
                        ${isLocked ? '<i class="fa-solid fa-lock-open mr-1"></i> 解鎖' : '<i class="fa-solid fa-lock mr-1"></i> 鎖定'}
                    </button>`
                }
                <button class="bg-indigo-50 hover:bg-indigo-100 text-indigo-600 border border-indigo-200 px-2.5 py-1.5 rounded-lg text-[11px] font-bold transition-colors view-data-btn shadow-sm cursor-pointer" data-id="${id}" data-email="${u.email || u.displayName}">
                    <i class="fa-solid fa-eye mr-1"></i> 查看資料
                </button>
                <button class="bg-amber-100 hover:bg-amber-200 text-amber-700 px-2.5 py-1.5 rounded-lg text-[11px] font-bold transition-colors send-banner-btn shadow-sm cursor-pointer" data-id="${id}">
                    <i class="fa-solid fa-bullhorn mr-1"></i> 廣播
                </button>
                <button class="bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 px-2.5 py-1.5 rounded-lg text-[11px] font-bold transition-colors force-reset-btn shadow-sm cursor-pointer" data-id="${id}">
                    <i class="fa-solid fa-rotate-left mr-1"></i> 重置
                </button>
                <button class="bg-red-600 hover:bg-red-700 text-white border border-red-800 px-2.5 py-1.5 rounded-lg text-[11px] font-bold transition-colors delete-user-btn shadow-sm cursor-pointer" data-id="${id}" data-name="${u.displayName || u.email || id}">
                    <i class="fa-solid fa-trash mr-1"></i> 刪除
                </button>
            </td>
        `;
        usersList.appendChild(tr);
    });

    // 綁定操作按鈕
    usersList.querySelectorAll('.toggle-lock-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const targetBtn = e.target.closest('.toggle-lock-btn');
            if (!targetBtn) return;
            const id = targetBtn.dataset.id;
            const currentlyLocked = targetBtn.dataset.locked === 'true';
            try {
                await updateDoc(doc(fbDb, 'artifacts', globalAppId, 'public', 'data', 'userProfiles', id), { isLocked: !currentlyLocked });
                const cached = adminCachedUsers.find(u => u.id === id);
                if (cached) cached.isLocked = !currentlyLocked;
                renderAdminUsersList();
                showToast(currentlyLocked ? "帳戶已解鎖" : "帳戶已凍結", "info");
            } catch(err) { showToast("操作失敗", "error"); }
        });
    });
    
    usersList.querySelectorAll('.view-data-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const targetBtn = e.target.closest('.view-data-btn');
            if (!targetBtn) return;
            const id = targetBtn.dataset.id;
            const email = targetBtn.dataset.email;
            if (adminUsersCallback) adminUsersCallback(id, email);
        });
    });

    usersList.querySelectorAll('.send-banner-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const targetBtn = e.target.closest('.send-banner-btn');
            if (!targetBtn) return;
            const id = targetBtn.dataset.id;
            const msg = prompt("請輸入要廣播給該用戶的系統橫幅：");
            if (msg) {
                try {
                    await updateDoc(doc(fbDb, 'artifacts', globalAppId, 'public', 'data', 'userProfiles', id), {
                        bannerMessage: msg, bannerActive: true, bannerId: Date.now().toString()
                    });
                    showToast("廣播推播成功！", "success");
                } catch(err) { showToast("推播失敗", "error"); }
            }
        });
    });

    usersList.querySelectorAll('.force-reset-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const targetBtn = e.target.closest('.force-reset-btn');
            if (!targetBtn) return;
            const id = targetBtn.dataset.id;
            const pass = prompt("【危險操作】請輸入 2FA 本地萬用密鑰以確認清空該用戶資料：");
            if (pass === "ianw0000") {
                try {
                    await updateDoc(doc(fbDb, 'artifacts', globalAppId, 'public', 'data', 'userProfiles', id), { forceReset: true });
                    showToast("重置核彈已發射！", "success");
                } catch(err) { showToast("重置失敗", "error"); }
            } else {
                showToast("2FA 密鑰驗證失敗！", "error");
            }
        });
    });

    usersList.querySelectorAll('.delete-user-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const targetBtn = e.target.closest('.delete-user-btn');
            if (!targetBtn) return;
            const id = targetBtn.dataset.id;
            const name = targetBtn.dataset.name || id;
            if (!confirm(`【確定刪除帳號？】\n\n確定要刪除用戶「${name}」？此操作將永久清除該用戶的資料庫設定與雲端作業資料，且不可復原！`)) {
                return;
            }
            try {
                await deleteDoc(doc(fbDb, 'artifacts', globalAppId, 'public', 'data', 'userProfiles', id));
                await deleteDoc(doc(fbDb, 'artifacts', globalAppId, 'users', id, 'appData', 'mainDoc'));
                try {
                    await deleteDoc(doc(fbDb, 'artifacts', globalAppId, 'public', 'data', 'boundAccounts', id));
                } catch(e) {}
                adminCachedUsers = adminCachedUsers.filter(u => u.id !== id);
                renderAdminUsersList();
                showToast(`用戶「${name}」帳戶已成功刪除`, "success");
            } catch(err) {
                console.error("Delete user failed:", err);
                showToast("刪除失敗：" + (err?.message || "權限不足"), "error");
            }
        });
    });
}

export async function loadAllUsersForAdmin(onViewDataCallback) {
    if (!isGoogleAdmin(state.currentUser)) return;
    adminUsersCallback = onViewDataCallback;
    setupAdminFilterListeners();
    loadServerConfigForAdmin();

    const devBadge = document.getElementById('admin-dev-badge');
    if (devBadge) {
        if (state?.isDevMode || sessionStorage.getItem('app_dev_mode') === 'true') {
            devBadge.classList.remove('hidden');
        } else {
            devBadge.classList.add('hidden');
        }
    }

    const usersList = document.getElementById('admin-users-list');
    const countBadge = document.getElementById('admin-user-count-badge');
    if (!usersList) return;
    if (countBadge) countBadge.textContent = '載入中...';
    usersList.innerHTML = '<tr><td colspan="5" class="text-center p-6 text-slate-500 font-bold"><i class="fa-solid fa-tower-broadcast mr-1"></i> 正在載入全球伺服器資料...</td></tr>';
    
    try {
        const usersRef = collection(fbDb, 'artifacts', globalAppId, 'public', 'data', 'userProfiles');
        const snapshot = await getDocs(usersRef);
        
        const userMap = new Map();
        snapshot.forEach(docSnap => {
            const data = docSnap.data() || {};
            const id = docSnap.id;
            const email = (data.email || '').trim();
            const isGuest = Boolean(data.isGuest || !email || email.includes('guest') || data.displayName === '訪客');
            const isAdmin = Boolean(email && email.toLowerCase() === 'ianw.solar@gmail.com');
            userMap.set(id, {
                id,
                data,
                email,
                displayName: data.displayName || data.username || data.name || (isGuest ? '訪客' : '一般用戶'),
                isGuest,
                isAdmin,
                isLocked: Boolean(data.isLocked),
                lastActive: data.lastActive,
                dataSizeKB: data.dataSizeKB
            });
        });

        // 整合 boundAccounts 確保所有已註冊帳號均能呈現在後台
        try {
            const localBounds = JSON.parse(localStorage.getItem('bound_accounts_all') || localStorage.getItem('bound_accounts_ianw') || '[]');
            localBounds.forEach(acc => {
                const accId = acc.id || acc.uid;
                if (accId && !userMap.has(accId)) {
                    const accEmail = (acc.email || acc.authEmail || '').trim();
                    const isGuest = Boolean(!accEmail || accEmail.includes('guest'));
                    const isAdmin = Boolean(accEmail && accEmail.toLowerCase() === 'ianw.solar@gmail.com');
                    userMap.set(accId, {
                        id: accId,
                        data: acc,
                        email: accEmail,
                        displayName: acc.displayName || acc.username || acc.name || '註冊用戶',
                        isGuest,
                        isAdmin,
                        isLocked: false,
                        lastActive: acc.createdAt,
                        dataSizeKB: 0
                    });
                }
            });
        } catch(e) {}

        adminCachedUsers = Array.from(userMap.values());
        renderAdminUsersList();
    } catch(err) {
        usersList.innerHTML = `<tr><td colspan="5" class="text-center p-6 text-rose-500 font-bold">載入失敗: ${err.message}</td></tr>`;
        if (countBadge) countBadge.textContent = '載入失敗';
    }
}

export async function deleteCloudParentClass(code) {
    if (!fbDb || !code) return;
    try {
        const parentDocRef = doc(fbDb, 'artifacts', globalAppId, 'public', 'data', 'parentClasses', String(code).trim());
        await deleteDoc(parentDocRef);
    } catch (e) {
        console.warn("Delete parent class from cloud error:", e);
    }
}

let unsubAppData = null;
let lastSyncedDataStr = null;

export function startRealtimeCloudSync() {
    if (state.adminViewModeUserId || sessionStorage.getItem('app_is_guest_mode') === 'true' || !fbDb) return;
    if (state.currentUser?.isDevMode) return;
    
    // 必須在 Firebase Auth 驗證完成後或存在 QR 授權 Session 時才啟動即時監聽
    const isQrAuth = Boolean(state.currentUser?.isQrAuthorized || sessionStorage.getItem('qr_authorized_session'));
    const authUser = fbAuth?.currentUser;
    const targetUid = authUser?.uid || (isQrAuth ? state.currentUser?.uid : null);
    if (!targetUid) return;

    if (unsubAppData) {
        try { unsubAppData(); } catch(e) {}
        unsubAppData = null;
    }

    const applyIncomingData = (payload) => {
        if (state.adminViewModeUserId || sessionStorage.getItem('app_is_guest_mode') === 'true') return;
        if (!payload || !payload.data) return;

        const incomingStr = payload.data;
        const currentStr = safeStringify(state.appData);

        if (incomingStr === currentStr || incomingStr === lastSyncedDataStr) {
            lastSyncedDataStr = incomingStr;
            return;
        }

        if (state.isSaving) {
            return;
        }

        try {
            const cloudData = sanitizeAppData(JSON.parse(incomingStr));
            fixDates(cloudData);
            state.appData = cloudData;
            lastSyncedDataStr = incomingStr;
            const userKey = getUserStorageKey(state.currentUser);
            localStorage.setItem('homeworkAppData_' + userKey, incomingStr);
            localStorage.setItem('homeworkAppData', incomingStr);

            if (state.currentClassId && !state.appData.classes.some(c => c.id === state.currentClassId)) {
                state.currentClassId = state.appData.classes[0]?.id || null;
                if (state.currentClassId) {
                    localStorage.setItem('currentClassId_' + userKey, state.currentClassId);
                    localStorage.setItem('currentClassId', state.currentClassId);
                } else {
                    localStorage.removeItem('currentClassId_' + userKey);
                    localStorage.removeItem('currentClassId');
                }
            } else if (!state.currentClassId && state.appData.classes.length > 0) {
                state.currentClassId = state.appData.classes[0].id;
                localStorage.setItem('currentClassId_' + userKey, state.currentClassId);
                localStorage.setItem('currentClassId', state.currentClassId);
            }

            if (window.fullRender) window.fullRender();
            if (window.reRenderCurrentPage) window.reRenderCurrentPage();

            const syncStatus = document.getElementById('cloud-sync-status');
            if (syncStatus && (fbAuth?.currentUser || state.currentUser)) {
                const u = fbAuth?.currentUser || state.currentUser;
                const timeStr = new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                syncStatus.innerHTML = `狀態：跨裝置即時同步中 <br><span class="text-sky-900 font-bold bg-white px-3 py-1.5 rounded-xl inline-block mt-2 shadow-sm border border-sky-100 text-[11px] tracking-wide"><i class="fa-solid fa-user mr-1 text-sky-600"></i> ${u.displayName || u.email}</span><br><span class="text-[10px] text-emerald-600 font-bold mt-1 inline-block">● 於 ${timeStr} 接收跨裝置即時更新</span>`;
            }
        } catch (err) {
            console.warn("Realtime cloud sync parse notice:", err);
        }
    };

    const listenToSyncChannel = () => {
        if (!targetUid) return;
        try {
            const syncDocRef = doc(fbDb, 'artifacts', globalAppId, 'public', 'data', 'userProfiles', `sync_${targetUid}`);
            unsubAppData = onSnapshot(syncDocRef, { includeMetadataChanges: false }, (docSnap) => {
                if (docSnap.metadata && docSnap.metadata.hasPendingWrites) return;
                if (!docSnap.exists()) return;
                applyIncomingData(docSnap.data());
            }, (e) => {
                console.warn("Sync channel listen notice:", e?.message || e);
            });
        } catch (e) {}
    };

    try {
        if (authUser?.uid) {
            const docRef = doc(fbDb, 'artifacts', globalAppId, 'users', targetUid, 'appData', 'mainDoc');
            unsubAppData = onSnapshot(docRef, { includeMetadataChanges: false }, (docSnap) => {
                if (state.adminViewModeUserId || sessionStorage.getItem('app_is_guest_mode') === 'true') return;
                if (docSnap.metadata && docSnap.metadata.hasPendingWrites) return;
                if (fbAuth?.currentUser?.uid !== targetUid) return;
                if (!docSnap.exists()) return;
                applyIncomingData(docSnap.data());
            }, (err) => {
                if (err?.code === 'permission-denied') {
                    if (unsubAppData) {
                        try { unsubAppData(); } catch(e) {}
                        unsubAppData = null;
                    }
                    listenToSyncChannel();
                    return;
                }
                console.warn("Realtime cloud sync listen notice:", err?.message || err);
            });
        } else if (isQrAuth && targetUid) {
            listenToSyncChannel();
        }
    } catch(e) {
        console.warn("Start realtime sync failed:", e);
    }
}

export function stopRealtimeCloudSync() {
    if (unsubAppData) {
        try { unsubAppData(); } catch(e) {}
        unsubAppData = null;
    }
}

if (typeof window !== 'undefined') {
    window.addEventListener('visibilitychange', () => {
        if (!document.hidden && (fbAuth?.currentUser || state.currentUser) && !state.adminViewModeUserId && sessionStorage.getItem('app_is_guest_mode') !== 'true') {
            startRealtimeCloudSync();
        } else if (document.hidden) {
            // 切換分頁、後台或即將關閉時，立即執行急速自救同步
            if (window.flushPendingSave) window.flushPendingSave();
        }
    });
    window.addEventListener('beforeunload', () => {
        if (window.flushPendingSave) window.flushPendingSave();
    });
    window.addEventListener('pagehide', () => {
        if (window.flushPendingSave) window.flushPendingSave();
    });
    window.addEventListener('online', () => {
        if ((fbAuth?.currentUser || state.currentUser) && !state.adminViewModeUserId && sessionStorage.getItem('app_is_guest_mode') !== 'true') {
            startRealtimeCloudSync();
        }
    });
}

export async function syncDataToCloud() {
    const isQrAuth = Boolean(state.currentUser?.isQrAuthorized || sessionStorage.getItem('qr_authorized_session'));
    if (state.adminViewModeUserId || sessionStorage.getItem('app_is_guest_mode') === 'true' || !state.currentUser || !fbDb) return;
    if (!fbAuth?.currentUser && !isQrAuth) return;

    try {
        const authUid = fbAuth?.currentUser?.uid;
        const targetUid = authUid || (isQrAuth ? state.currentUser.uid : null);
        if (!targetUid) return;

        // 嚴格身分校驗：防止切換帳號過渡期非同步調用導致前一帳號資料寫入新帳號之雲端
        if (authUid && state.currentUser.uid && state.currentUser.uid !== authUid && !state.currentUser.isDevMode && !isQrAuth) {
            console.warn("UID mismatch in syncDataToCloud, aborting sync to prevent overwrite:", state.currentUser.uid, authUid);
            return;
        }

        const dataStr = safeStringify(state.appData);
        lastSyncedDataStr = dataStr;

        // 若具備 Firebase Auth 認證，同步寫入官方私有 mainDoc
        if (authUid) {
            try {
                const docRef = doc(fbDb, 'artifacts', globalAppId, 'users', targetUid, 'appData', 'mainDoc');
                await setDoc(docRef, { data: dataStr, updatedAt: new Date().toISOString() });
            } catch (mainDocErr) {
                console.warn("MainDoc write notice:", mainDocErr?.message || mainDocErr);
            }
        }

        // 同步寫入跨設備快取通道 (保證跨裝置即時雙向互通)
        try {
            const syncDocRef = doc(fbDb, 'artifacts', globalAppId, 'public', 'data', 'userProfiles', `sync_${targetUid}`);
            await setDoc(syncDocRef, {
                data: dataStr,
                updatedAt: new Date().toISOString(),
                userEmail: state.currentUser.email || '',
                userDisplayName: state.currentUser.displayName || ''
            });
        } catch (syncChannelErr) {
            console.warn("SyncChannel write notice:", syncChannelErr?.message || syncChannelErr);
        }

        if (Array.isArray(state.appData.classes)) {
            for (const c of state.appData.classes) {
                if (c && c.accessCode && String(c.accessCode).trim()) {
                    const code = String(c.accessCode).trim();
                    const parentDocRef = doc(fbDb, 'artifacts', globalAppId, 'public', 'data', 'parentClasses', code);
                    const classHomeworks = (state.appData.homeworks || []).filter(h => h.classId === c.id).map(h => ({
                        id: h.id,
                        name: h.name,
                        typeId: h.typeId || 'default',
                        createdAt: h.createdAt instanceof Date ? h.createdAt.toISOString() : (h.createdAt || new Date().toISOString()),
                        studentCount: typeof h.studentCount === 'number' ? h.studentCount : (h.students || []).length,
                        students: (h.students || []).map(s => ({ seat: s.seat, status: s.status }))
                    }));
                    // 規範：教師端絕不擅自生成預設 PIN 碼！成績認證碼一開始由學校統一設定，教師只能查看與個別修改
                    c.studentPins = c.studentPins || {};

                    // 保護學生已提交之小考成績、家長簽名、回覆，以及學校行政處室之抽查核章紀錄
                    let cloudInspectionStamps = c.inspectionStamps || [];
                    let cloudLatestInspection = c.latestInspection || null;
                    try {
                        const existingSnap = await getDoc(parentDocRef);
                        if (existingSnap.exists()) {
                            const cloudData = existingSnap.data() || {};
                            const cloudExams = cloudData.exams || [];
                            (c.exams || []).forEach(localExam => {
                                const cloudExam = cloudExams.find(ce => ce.id === localExam.id);
                                if (cloudExam && cloudExam.submissions) {
                                    localExam.submissions = {
                                        ...cloudExam.submissions,
                                        ...(localExam.submissions || {})
                                    };
                                }
                            });
                            if (cloudData.contactSignatures) {
                                c.contactSignatures = {
                                    ...cloudData.contactSignatures,
                                    ...(c.contactSignatures || {})
                                };
                            }
                            if (cloudData.affairResponses) {
                                c.affairResponses = {
                                    ...cloudData.affairResponses,
                                    ...(c.affairResponses || {})
                                };
                            }
                            // 若雲端已有學校派發的 PIN 碼且本地尚未設定，自動繼承學校派發之 PIN 碼
                            if (cloudData.studentPins && Object.keys(cloudData.studentPins).length > 0 && (!c.studentPins || Object.keys(c.studentPins).length === 0)) {
                                c.studentPins = { ...cloudData.studentPins };
                            }
                            // 完整保留學校管理端蓋上的電子行政核章戳記
                            if (Array.isArray(cloudData.inspectionStamps) && cloudData.inspectionStamps.length > 0) {
                                cloudInspectionStamps = cloudData.inspectionStamps;
                                c.inspectionStamps = cloudInspectionStamps;
                            }
                            if (cloudData.latestInspection) {
                                cloudLatestInspection = cloudData.latestInspection;
                                c.latestInspection = cloudLatestInspection;
                            }
                        }
                    } catch (e) {}

                    const parentPayload = {
                        classId: c.id,
                        className: c.name,
                        accessCode: code,
                        lastMaxSeat: typeof c.lastMaxSeat === 'number' ? c.lastMaxSeat : 30,
                        lastMissingSeats: c.lastMissingSeats || '',
                        teacherEmail: state.currentUser.email || '',
                        teacherName: state.currentUser.displayName || state.currentUser.email || '班級導師',
                        teacherUid: targetUid,
                        updatedAt: new Date().toISOString(),
                        homeworks: classHomeworks,
                        contactBook: c.contactBook || {},
                        homeworkTypes: safeClone(state.appData.homeworkTypes || DEFAULT_TYPES),
                        studentPins: c.studentPins || {},
                        exams: c.exams || [],
                        officers: c.officers || {},
                        dutySettings: c.dutySettings || {},
                        attendance: c.attendance || {},
                        affairs: c.affairs || [],
                        affairResponses: c.affairResponses || {},
                        contactSignatures: c.contactSignatures || {},
                        bulletinNotice: c.bulletinNotice || '',
                        inspectionStamps: cloudInspectionStamps,
                        latestInspection: cloudLatestInspection
                    };
                    await setDoc(parentDocRef, {
                        ...parentPayload,
                        data: safeStringify(parentPayload),
                        updatedAt: new Date().toISOString()
                    });

                    // 同步晨間出缺席通報至學校學務處 (若今日有出缺席紀錄)
                    const todayStr = new Date().toISOString().split('T')[0];
                    if (c.attendance && c.attendance[todayStr]) {
                        try {
                            const todayAtt = c.attendance[todayStr];
                            const maxSeat = typeof c.lastMaxSeat === 'number' ? c.lastMaxSeat : 30;
                            const absentSeats = [];
                            const tardySeats = [];
                            let presentCount = 0;
                            for (let s = 1; s <= maxSeat; s++) {
                                const st = todayAtt[s]?.status || 'present';
                                if (st === 'present') presentCount++;
                                else if (st === 'tardy') tardySeats.push(s);
                                else absentSeats.push(s);
                            }
                            const schoolId = state.currentUser?.schoolId || c.schoolId || 'shs';
                            const schAttRef = doc(fbDb, 'artifacts', globalAppId, 'public', 'data', 'userProfiles', `sch_att_${schoolId}_${todayStr}`);
                            const schAttSnap = await getDoc(schAttRef);
                            let list = [];
                            if (schAttSnap.exists() && Array.isArray(schAttSnap.data()?.list)) {
                                list = schAttSnap.data().list;
                            }
                            const attRec = {
                                schoolId,
                                classCode: code,
                                className: c.name,
                                totalStudents: maxSeat,
                                presentCount,
                                absentCount: absentSeats.length,
                                tardyCount: tardySeats.length,
                                absentSeats,
                                tardySeats,
                                reportedAt: new Date().toISOString(),
                                reportedBy: state.currentUser?.displayName || '導師'
                            };
                            const existIdx = list.findIndex(r => r.classCode === code);
                            if (existIdx >= 0) list[existIdx] = attRec;
                            else list.push(attRec);
                            await setDoc(schAttRef, { list, updatedAt: new Date().toISOString() }, { merge: true });
                        } catch (attSyncErr) {
                            console.warn("晨間出缺席通報至學務處提示:", attSyncErr);
                        }
                    }
                }
            }
        }
        state.lastCloudError = null;
    } catch (error) { 
        console.warn("Cloud sync notice:", error.message || error); 
        state.lastCloudError = error.message; 
    }
}

export async function loadDataFromCloud(silent = false, onLoadedCallback) {
    const isQrAuth = Boolean(state.currentUser?.isQrAuthorized || sessionStorage.getItem('qr_authorized_session'));
    if (!state.currentUser || !fbDb) return false;
    if (!fbAuth?.currentUser && !isQrAuth) return false;

    try {
        const isInspectingUser = Boolean(state.adminViewModeUserId);
        let targetUid = state.adminViewModeUserId || fbAuth?.currentUser?.uid || (isQrAuth ? state.currentUser?.uid : null);
        if (!targetUid) return false;

        let docSnap = null;
        if (fbAuth?.currentUser?.uid || isInspectingUser) {
            try {
                let docRef = doc(fbDb, 'artifacts', globalAppId, 'users', targetUid, 'appData', 'mainDoc');
                docSnap = await getDoc(docRef);
            } catch (docErr) {
                console.warn("MainDoc get notice:", docErr?.message || docErr);
            }
        }

        // 若無 mainDoc 或權限限制，備援讀取跨設備同步通道
        if ((!docSnap || !docSnap.exists()) && targetUid) {
            try {
                let syncDocRef = doc(fbDb, 'artifacts', globalAppId, 'public', 'data', 'userProfiles', `sync_${targetUid}`);
                let syncDocSnap = await getDoc(syncDocRef);
                if (syncDocSnap.exists()) {
                    docSnap = syncDocSnap;
                }
            } catch (e) {}
        }

        if (docSnap.exists() && docSnap.data()?.data) {
            const rawStr = docSnap.data().data;
            lastSyncedDataStr = rawStr;
            const cloudData = sanitizeAppData(JSON.parse(rawStr));
            if (isInspectingUser) {
                // 管理員檢視模式：純記憶體呈現，嚴禁覆蓋本機管理員自身之 localStorage
                state.appData = cloudData;
                fixDates(state.appData);
                state.currentClassId = state.appData.classes?.[0]?.id || null;
                if (onLoadedCallback) onLoadedCallback();
                showToast(`已成功載入「${state.adminViewModeUserEmail || targetUid}」之點收資料（唯讀）`, 'success');
                return true;
            } else if (silent) { 
                state.appData = cloudData; 
                fixDates(state.appData); 
                const userKey = getUserStorageKey(state.currentUser);
                localStorage.setItem('homeworkAppData_' + userKey, rawStr);
                localStorage.setItem('homeworkAppData', rawStr); 
                if (!state.currentClassId && state.appData.classes.length > 0) {
                    state.currentClassId = state.appData.classes[0].id;
                    localStorage.setItem('currentClassId_' + userKey, state.currentClassId);
                    localStorage.setItem('currentClassId', state.currentClassId);
                }
                if (onLoadedCallback) onLoadedCallback();
                startRealtimeCloudSync();
                showToast('已從雲端自動還原您的資料！', 'success');
                return true;
            } 
            else {
                showConfirmModal('發現雲端備份', '確定要將本地資料完全覆蓋為雲端上的最新紀錄嗎？這會清除未上傳的本地更動。', () => {
                    state.appData = cloudData; 
                    fixDates(state.appData); 
                    const userKey = getUserStorageKey(state.currentUser);
                    localStorage.setItem('homeworkAppData_' + userKey, rawStr);
                    localStorage.setItem('homeworkAppData', rawStr); 
                    if (!state.currentClassId && state.appData.classes.length > 0) {
                        state.currentClassId = state.appData.classes[0].id;
                        localStorage.setItem('currentClassId_' + userKey, state.currentClassId);
                        localStorage.setItem('currentClassId', state.currentClassId);
                    }
                    if (onLoadedCallback) onLoadedCallback();
                    startRealtimeCloudSync();
                    // 確保所有班級權限碼與資料皆即時上發至 parentClasses，以供學生端與家長端連線
                    syncDataToCloud().catch(err => console.warn('Background sync on load:', err));
                    showToast('已成功從雲端載入資料！', 'success');
                });
                return true;
            }
        } else {
            if (isInspectingUser) {
                // 該用戶雲端無資料：給予乾淨空狀態以供檢視，不覆蓋管理員資料
                state.appData = { classes: [], homeworks: [], homeworkTypes: safeClone(DEFAULT_TYPES) };
                state.currentClassId = null;
                if (onLoadedCallback) onLoadedCallback();
                showToast(`用戶「${state.adminViewModeUserEmail || targetUid}」在雲端尚無備份資料`, 'info');
                return true;
            } else {
                const userKey = getUserStorageKey(state.currentUser);
                // 檢查本地是否已有該用戶的資料（例如曾在此設備建立過但尚未同步或初次登入）
                const localData = loadLocalDataForUser(state.currentUser);
                if (localData && Array.isArray(localData.classes) && localData.classes.length > 0) {
                    state.appData = localData;
                    fixDates(state.appData);
                    state.currentClassId = localStorage.getItem('currentClassId_' + userKey) || state.appData.classes[0]?.id || null;
                    // 將本機資料同步上雲，絕對不覆蓋摧毀使用者的成果
                    await syncDataToCloud();
                    if (onLoadedCallback) onLoadedCallback();
                    startRealtimeCloudSync();
                    if (!silent) showToast('已從本機載入此帳號資料，並自動備份至雲端！', 'success');
                    return true;
                } else {
                    // 全新空帳號初始化
                    state.appData = { classes: [], homeworks: [], homeworkTypes: safeClone(DEFAULT_TYPES) };
                    state.currentClassId = null;
                    const emptyStr = safeStringify(state.appData);
                    localStorage.setItem('homeworkAppData_' + userKey, emptyStr);
                    localStorage.setItem('homeworkAppData', emptyStr);
                    localStorage.removeItem('currentClassId_' + userKey);
                    localStorage.removeItem('currentClassId');
                    if (onLoadedCallback) onLoadedCallback();
                    startRealtimeCloudSync();
                    if (!silent) showToast('在您的雲端帳戶中尚無備份資料（已建立全新空白作業本）。', 'info');
                    return false;
                }
            }
        }
    } catch(e) { 
        console.error(e); 
        if(!silent) showToast("下載失敗：" + e.message, "error"); 
        return false; 
    }
}

export async function deleteMyAccount() {
    const user = fbAuth?.currentUser || state.currentUser;
    if (!user) {
        showToast("尚未登入帳號", "warning");
        return;
    }

    const uid = fbAuth?.currentUser?.uid || state.currentUser?.uid;
    const email = user.email || user.displayName || "目前登入的帳號";

    const confirmed = confirm(`【確定註銷並刪除帳號？】\n\n您即將刪除帳號【${email}】。\n\n此操作將會：\n1. 永久刪除您在雲端保存的所有班級、學生與作業紀錄\n2. 刪除所有雲端備份與設定檔\n3. 清空本機暫存並登出系統\n\n此操作無法復原！是否確定要繼續刪除？`);
    if (!confirmed) return;

    try {
        showToast("正在永久刪除雲端資料與註銷帳號...", "info");

        // 1. 刪除雲端個人與作業資料
        if (uid && fbDb) {
            try {
                await deleteDoc(doc(fbDb, 'artifacts', globalAppId, 'public', 'data', 'userProfiles', uid));
            } catch(e) { console.warn("Failed to delete profile doc:", e); }

            try {
                await deleteDoc(doc(fbDb, 'artifacts', globalAppId, 'users', uid, 'appData', 'mainDoc'));
            } catch(e) { console.warn("Failed to delete main doc:", e); }

            try {
                await deleteDoc(doc(fbDb, 'artifacts', globalAppId, 'public', 'data', 'boundAccounts', uid));
            } catch(e) {}
        }

        // 2. 嘗試刪除 Firebase Auth 帳戶 (若權限許可)
        let authDeleted = false;
        if (fbAuth?.currentUser) {
            try {
                await fbAuth.currentUser.delete();
                authDeleted = true;
            } catch (authErr) {
                console.warn("fbAuth delete error (token may require recent login):", authErr);
            }
        }

        // 3. 清除本機快取
        stopRealtimeCloudSync();
        const userKey = getUserStorageKey(state.currentUser);
        localStorage.removeItem('homeworkAppData_' + userKey);
        localStorage.removeItem('currentClassId_' + userKey);
        localStorage.removeItem('homeworkAppData');
        localStorage.removeItem('currentClassId');
        localStorage.removeItem('currentUser');
        sessionStorage.clear();

        state.currentUser = null;
        if (window.cleanUpChatListeners) window.cleanUpChatListeners();

        // 4. 登出
        try {
            await signOut(fbAuth);
        } catch(e) {}

        showToast(authDeleted ? "帳號與雲端資料已永久註銷並刪除！" : "雲端資料與帳戶紀錄已全數清空！", "success");

        // 5. 關閉彈窗並返回入口頁
        const settingsModal = document.getElementById('settings-modal');
        if (settingsModal) closeModal(settingsModal);

        setTimeout(() => {
            window.location.hash = '#portal';
            window.location.reload();
        }, 1000);
    } catch (err) {
        console.error("Delete account error:", err);
        showToast("刪除過程中發生錯誤：" + (err?.message || "請稍後再試"), "error");
    }
}

export async function syncClassStudentPinsToCloud(classObj) {
    if (!classObj) return;
    try {
        const rawCode = String(classObj.accessCode || classObj.id || '').trim();
        const numCode = (String(classObj.classCode || '').match(/\d+/) || rawCode.match(/\d+/) || String(classObj.name || '').match(/\d+/))?.[0] || rawCode;
        const codes = [rawCode, numCode, `SHS_${numCode}`, `shs_${numCode}`, `shs_${numCode}_parent`].filter(Boolean);
        const currentPins = classObj.studentPins || {};
        const nowIso = new Date().toISOString();

        // 寫入 parentClasses 多別名
        if (fbDb) {
            for (const pc of [...new Set(codes)]) {
                const parentDocRef = doc(fbDb, 'artifacts', globalAppId, 'public', 'data', 'parentClasses', pc);
                await setDoc(parentDocRef, {
                    classCode: numCode,
                    className: classObj.name || `${numCode}班`,
                    studentPins: currentPins,
                    updatedAt: nowIso
                }, { merge: true }).catch(() => {});
            }

            // 同步寫入學校專屬 PIN 碼通道 sch_pins_{numCode}
            if (numCode) {
                const pinDocRef = doc(fbDb, 'artifacts', globalAppId, 'public', 'data', 'userProfiles', `sch_pins_${numCode}`);
                await setDoc(pinDocRef, {
                    classCode: numCode,
                    className: classObj.name || `${numCode}班`,
                    studentPins: currentPins,
                    updatedAt: nowIso,
                    updatedBy: 'teacher'
                }, { merge: true }).catch(() => {});

                // 同步寫入 schoolClasses/{numCode}
                const scDocRef = doc(fbDb, 'artifacts', globalAppId, 'public', 'data', 'schoolClasses', numCode);
                await setDoc(scDocRef, {
                    classCode: numCode,
                    className: classObj.name || `${numCode}班`,
                    studentPins: currentPins,
                    updatedAt: nowIso
                }, { merge: true }).catch(() => {});
            }

            // 同步更新學校全校班級清冊 userProfiles/sch_classes_{schoolId}
            for (const schId of ['shs', 'test_school']) {
                try {
                    const schListRef = doc(fbDb, 'artifacts', globalAppId, 'public', 'data', 'userProfiles', `sch_classes_${schId}`);
                    const snap = await getDoc(schListRef);
                    if (snap.exists() && Array.isArray(snap.data()?.list)) {
                        const list = snap.data().list;
                        let found = false;
                        for (const sc of list) {
                            if (sc.classCode === numCode || String(sc.className || '').includes(numCode)) {
                                sc.studentPins = { ...currentPins };
                                sc.updatedAt = nowIso;
                                found = true;
                            }
                        }
                        if (found) {
                            await setDoc(schListRef, { list, updatedAt: nowIso }, { merge: true });
                        }
                    }
                } catch(e) {}
            }

            // Update userProfiles for each configured seat
            if (classObj.studentPins) {
                for (const [seat, pin] of Object.entries(classObj.studentPins)) {
                    if (pin) {
                        const studentDocId = `studentScores_${numCode}_seat${seat}`;
                        const profileDocRef = doc(fbDb, 'artifacts', globalAppId, 'public', 'data', 'userProfiles', studentDocId);
                        await setDoc(profileDocRef, {
                            classCode: numCode,
                            seat: String(seat),
                            parentPin: String(pin),
                            updatedAt: nowIso
                        }, { merge: true }).catch(() => {});
                    }
                }
            }
        }

        // 同步更新本地瀏覽器 localStorage 中的學校班級暫存 (同網域即時互通)
        try {
            for (let i = 0; i < localStorage.length; i++) {
                const k = localStorage.key(i);
                if (k && (k.startsWith('school_classes_') || k.startsWith('school_admin_classes_'))) {
                    const raw = localStorage.getItem(k);
                    if (raw) {
                        const list = JSON.parse(raw);
                        if (Array.isArray(list)) {
                            let updated = false;
                            for (const sc of list) {
                                if (sc.classCode === numCode || String(sc.className || '').includes(numCode)) {
                                    sc.studentPins = { ...currentPins };
                                    sc.updatedAt = nowIso;
                                    updated = true;
                                }
                            }
                            if (updated) {
                                localStorage.setItem(k, JSON.stringify(list));
                            }
                        }
                    }
                }
            }

            // 發送跨頁籤雙向即時同步事件
            localStorage.setItem('school_pins_sync_event', JSON.stringify({
                classCode: numCode,
                studentPins: currentPins,
                timestamp: Date.now()
            }));
            window.dispatchEvent(new CustomEvent('class_pins_updated', {
                detail: { classCode: numCode, studentPins: currentPins }
            }));
        } catch(e) {}
    } catch (e) {
        console.warn("syncClassStudentPinsToCloud error:", e);
    }
}

/**
 * 自學校端雲端中樞或本地快取即時拉取該班最新學生 PIN 碼清冊
 */
export async function fetchClassStudentPinsFromCloud(classObj) {
    if (!classObj) return null;
    
    // 提取可能的班級代碼（例如 702、701 等）
    const candidates = [];
    if (classObj.classCode) candidates.push(String(classObj.classCode).trim());
    const digitsInId = String(classObj.id || '').match(/\d+/);
    if (digitsInId) candidates.push(digitsInId[0]);
    const digitsInAccess = String(classObj.accessCode || '').match(/\d+/);
    if (digitsInAccess) candidates.push(digitsInAccess[0]);
    const digitsInName = String(classObj.name || '').match(/\d+/);
    if (digitsInName) candidates.push(digitsInName[0]);
    if (classObj.accessCode) candidates.push(String(classObj.accessCode).trim());
    if (classObj.parentAccessCode) candidates.push(String(classObj.parentAccessCode).trim());
    if (classObj.teacherUsername) {
        const d = String(classObj.teacherUsername).match(/\d+/);
        if (d) candidates.push(d[0]);
    }
    const uniqueCodes = [...new Set(candidates.filter(Boolean))];

    // 1. 優先自雲端專屬通道讀取最新 PIN 碼 (Firestore 即時中樞)
    if (fbDb) {
        for (const code of uniqueCodes) {
            // A. userProfiles/sch_pins_{code}
            try {
                const pinRef = doc(fbDb, 'artifacts', globalAppId, 'public', 'data', 'userProfiles', `sch_pins_${code}`);
                const snap = await getDoc(pinRef);
                if (snap.exists() && snap.data()?.studentPins && Object.keys(snap.data().studentPins).length > 0) {
                    return snap.data().studentPins;
                }
            } catch(e) {}

            // B. schoolClasses/{code}
            try {
                const scRef = doc(fbDb, 'artifacts', globalAppId, 'public', 'data', 'schoolClasses', code);
                const snap = await getDoc(scRef);
                if (snap.exists() && snap.data()?.studentPins && Object.keys(snap.data().studentPins).length > 0) {
                    return snap.data().studentPins;
                }
            } catch(e) {}

            // C. schoolClasses/school_default_{code}
            try {
                const scDefRef = doc(fbDb, 'artifacts', globalAppId, 'public', 'data', 'schoolClasses', `school_default_${code}`);
                const snap = await getDoc(scDefRef);
                if (snap.exists() && snap.data()?.studentPins && Object.keys(snap.data().studentPins).length > 0) {
                    return snap.data().studentPins;
                }
            } catch(e) {}

            // D. parentClasses/SHS_{code}
            try {
                const pShsRef = doc(fbDb, 'artifacts', globalAppId, 'public', 'data', 'parentClasses', `SHS_${code}`);
                const snap = await getDoc(pShsRef);
                if (snap.exists() && snap.data()?.studentPins && Object.keys(snap.data().studentPins).length > 0) {
                    return snap.data().studentPins;
                }
            } catch(e) {}

            // E. parentClasses/{code}
            try {
                const pRef = doc(fbDb, 'artifacts', globalAppId, 'public', 'data', 'parentClasses', code);
                const snap = await getDoc(pRef);
                if (snap.exists() && snap.data()?.studentPins && Object.keys(snap.data().studentPins).length > 0) {
                    return snap.data().studentPins;
                }
            } catch(e) {}

            // F. boundAccounts/shs_{code}_teacher
            try {
                const bRef = doc(fbDb, 'artifacts', globalAppId, 'public', 'data', 'boundAccounts', `shs_${code}_teacher`);
                const snap = await getDoc(bRef);
                if (snap.exists() && snap.data()?.studentPins && Object.keys(snap.data().studentPins).length > 0) {
                    return snap.data().studentPins;
                }
            } catch(e) {}
        }
    }

    // 2. 本地多校暫存後備讀取 (離線或無雲端時之 Fallback)
    try {
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k && (k.startsWith('school_classes_') || k.startsWith('school_admin_classes_'))) {
                const list = JSON.parse(localStorage.getItem(k) || '[]');
                if (Array.isArray(list)) {
                    for (const sc of list) {
                        if (uniqueCodes.includes(sc.classCode) || uniqueCodes.some(c => sc.className?.includes(c))) {
                            if (sc.studentPins && Object.keys(sc.studentPins).length > 0) {
                                return sc.studentPins;
                            }
                        }
                    }
                }
            }
        }
    } catch (e) {}

    return null;
}

export async function syncClassExamsToCloud(classObj) {
    if (!fbDb || !classObj || !classObj.accessCode) return;
    try {
        const code = String(classObj.accessCode).trim();
        const parentDocRef = doc(fbDb, 'artifacts', globalAppId, 'public', 'data', 'parentClasses', code);
        try {
            const existingSnap = await getDoc(parentDocRef);
            if (existingSnap.exists()) {
                const cloudExams = existingSnap.data()?.exams || [];
                (classObj.exams || []).forEach(localExam => {
                    const cloudExam = cloudExams.find(ce => ce.id === localExam.id);
                    if (cloudExam && cloudExam.submissions) {
                        localExam.submissions = {
                            ...cloudExam.submissions,
                            ...(localExam.submissions || {})
                        };
                    }
                });
            }
        } catch (e) {}
        await setDoc(parentDocRef, {
            exams: classObj.exams || [],
            updatedAt: new Date().toISOString()
        }, { merge: true });
    } catch (e) {
        console.warn("syncClassExamsToCloud error:", e);
    }
}
