window.__ModuleLoader__.load({ id: "dsh-qqchat", factory: (require) => {
var __qqModules = {
"./plugin.cjs": function(module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const shared_cjs_1 = require("./shared.cjs");
const settings_cjs_1 = require("./settings.cjs");
const workspace_cjs_1 = require("./workspace.cjs");
exports.inject = ['slots', 'connection', 'uiConversation'];
exports.apply = function apply(ctx) {
    (0, shared_cjs_1.setQQRpc)(ctx.connection.rpc);
    ctx.effect(shared_cjs_1.installStyles, 'dsh-qqchat: client styles');
    ctx.effect(shared_cjs_1.installQQSettingsIcon, 'dsh-qqchat: QQ settings icon');
    ctx.uiConversation.events.register((0, workspace_cjs_1.createQQMessageDefinition)());
    ctx.slots.inject('settings.section', () => ctx.slots.register({ name: 'settings.section', id: 'qqchat', order: 35, label: () => 'QQ Chat', inject: () => ({ rpc: ctx.connection.rpc }) }, settings_cjs_1.QQSettings));
    ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({ name: 'conversation.chat.node', key: 'qqchat-message' }, workspace_cjs_1.QQTranscriptNode));
    ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({ name: 'conversation.session.header.utilities', id: 'qqchat-memory', order: 30, inject: () => ({ rpc: ctx.connection.rpc }) }, workspace_cjs_1.QQSessionUtility));
};

},
"./settings.cjs": function(module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.QQSettings = QQSettings;
const shared_cjs_1 = require("./shared.cjs");
let qqSettingsCache;
function QQSettings({ rpc }) {
    const [account, setAccount] = (0, shared_cjs_1.useState)(() => qqSettingsCache?.account || null);
    const [settings, setSettings] = (0, shared_cjs_1.useState)(() => qqSettingsCache?.settings || null);
    const [members, setMembers] = (0, shared_cjs_1.useState)(() => qqSettingsCache?.members || []);
    const [loading, setLoading] = (0, shared_cjs_1.useState)(() => qqSettingsCache === undefined);
    const [auth, setAuth] = (0, shared_cjs_1.useState)(null);
    const [connectionMode, setConnectionMode] = (0, shared_cjs_1.useState)('qr');
    const [manualAppId, setManualAppId] = (0, shared_cjs_1.useState)('');
    const [manualAppSecret, setManualAppSecret] = (0, shared_cjs_1.useState)('');
    const [manualSandbox, setManualSandbox] = (0, shared_cjs_1.useState)(false);
    const [logs, setLogs] = (0, shared_cjs_1.useState)(null);
    const [busy, setBusy] = (0, shared_cjs_1.useState)(false);
    const [error, setError] = (0, shared_cjs_1.useState)('');
    const [groupReplyMenuOpen, setGroupReplyMenuOpen] = (0, shared_cjs_1.useState)(false);
    const [directReplyMenuOpen, setDirectReplyMenuOpen] = (0, shared_cjs_1.useState)(false);
    const [ownerMenuOpen, setOwnerMenuOpen] = (0, shared_cjs_1.useState)(false);
    const [receiveHelpOpen, setReceiveHelpOpen] = (0, shared_cjs_1.useState)(false);
    const refresh = (0, shared_cjs_1.useCallback)(async () => {
        try {
            const [status, prefs] = await Promise.all([
                (0, shared_cjs_1.call)(rpc, 'status'),
                (0, shared_cjs_1.call)(rpc, 'settings/get'),
            ]);
            const next = {
                account: status.accounts.find(item => item.enabled) || null,
                settings: prefs.settings,
                members: prefs.members || [],
            };
            qqSettingsCache = next;
            setAccount(next.account);
            setSettings(next.settings);
            setMembers(next.members);
            setError('');
        }
        catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        }
        finally {
            setLoading(false);
        }
    }, [rpc]);
    (0, shared_cjs_1.useEffect)(() => { void refresh(); }, [refresh]);
    (0, shared_cjs_1.useEffect)(() => {
        if (!auth)
            return;
        let stopped = false;
        let timer;
        const poll = async () => {
            if (stopped)
                return;
            try {
                const state = await (0, shared_cjs_1.call)(rpc, 'auth/poll', { taskId: auth.taskId });
                if (state.status === 'success') {
                    setAuth(null);
                    await refresh();
                    return;
                }
                if (state.status === 'fail' || state.status === 'expired') {
                    setError(state.reason || '二维码已失效');
                    setAuth(null);
                    return;
                }
            }
            catch (err) {
                if (!stopped) {
                    setError(err instanceof Error ? err.message : String(err));
                    setAuth(null);
                }
                return;
            }
            if (!stopped)
                timer = setTimeout(() => void poll(), 3000);
        };
        timer = setTimeout(() => void poll(), 3000);
        return () => { stopped = true; if (timer)
            clearTimeout(timer); };
    }, [auth, rpc, refresh]);
    const patch = (0, shared_cjs_1.useCallback)(async (value) => {
        if (!settings)
            return;
        const optimistic = { ...settings, ...value };
        setSettings(optimistic);
        try {
            const result = await (0, shared_cjs_1.call)(rpc, 'settings/update', { patch: value });
            setSettings(result.settings);
            if (qqSettingsCache)
                qqSettingsCache = { ...qqSettingsCache, settings: result.settings };
            setError('');
        }
        catch (err) {
            setSettings(settings);
            setError(err instanceof Error ? err.message : String(err));
        }
    }, [rpc, settings]);
    const startAuth = async () => {
        setBusy(true);
        try {
            setAuth(await (0, shared_cjs_1.call)(rpc, 'auth/start'));
            setError('');
        }
        catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        }
        finally {
            setBusy(false);
        }
    };
    const connectManual = async () => {
        setBusy(true);
        try {
            await (0, shared_cjs_1.call)(rpc, 'account/manual-connect', { appId: manualAppId, appSecret: manualAppSecret, sandbox: manualSandbox });
            setManualAppSecret('');
            await refresh();
            setError('');
        }
        catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        }
        finally {
            setBusy(false);
        }
    };
    const disconnect = async () => {
        if (!account)
            return;
        setBusy(true);
        try {
            await (0, shared_cjs_1.call)(rpc, 'account/disconnect', { accountId: account.id });
            setAccount(null);
            if (qqSettingsCache)
                qqSettingsCache = { ...qqSettingsCache, account: null };
            setAuth(null);
            setError('已取消连接，可以重新扫码绑定 Bot。');
        }
        catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        }
        finally {
            setBusy(false);
        }
    };
    const openLogs = async () => {
        try {
            setLogs((await (0, shared_cjs_1.call)(rpc, 'logs/list', { limit: 300 })).logs);
        }
        catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        }
    };
    const ownerPicker = (0, shared_cjs_1.h)(shared_cjs_1.Menu, {
        open: ownerMenuOpen,
        onClose: () => setOwnerMenuOpen(false),
        selectedId: settings?.ownerUserId,
        onSelect: (id) => { setOwnerMenuOpen(false); void patch({ ownerUserId: id }); },
        anchor: (0, shared_cjs_1.h)(shared_cjs_1.Button, { size: 'sm', variant: 'outline', onClick: () => setOwnerMenuOpen(!ownerMenuOpen) }, '选择用户'),
        align: 'end',
        items: [{ id: '', label: '不设置 Owner' }, ...members.map(member => ({ id: member.platformUserId, label: member.displayName || 'QQ 群友' }))],
    });
    const formatLabel = (value) => value === 'markdown' ? 'Markdown' : value === 'compat' ? '纯文本兼容' : '智能兼容';
    const formatItems = [{ id: 'smart', label: '智能兼容' }, { id: 'markdown', label: 'Markdown' }, { id: 'compat', label: '纯文本兼容' }];
    const groupReplyPicker = (0, shared_cjs_1.h)(shared_cjs_1.Menu, {
        open: groupReplyMenuOpen,
        onClose: () => setGroupReplyMenuOpen(false),
        selectedId: settings?.groupReplyFormat,
        onSelect: (id) => { setGroupReplyMenuOpen(false); void patch({ groupReplyFormat: id }); },
        anchor: (0, shared_cjs_1.h)(shared_cjs_1.Button, { size: 'sm', variant: 'outline', onClick: () => setGroupReplyMenuOpen(!groupReplyMenuOpen) }, formatLabel(settings?.groupReplyFormat)),
        items: formatItems,
        align: 'end',
    });
    const directReplyPicker = (0, shared_cjs_1.h)(shared_cjs_1.Menu, {
        open: directReplyMenuOpen,
        onClose: () => setDirectReplyMenuOpen(false),
        selectedId: settings?.directReplyFormat,
        onSelect: (id) => { setDirectReplyMenuOpen(false); void patch({ directReplyFormat: id }); },
        anchor: (0, shared_cjs_1.h)(shared_cjs_1.Button, { size: 'sm', variant: 'outline', onClick: () => setDirectReplyMenuOpen(!directReplyMenuOpen) }, formatLabel(settings?.directReplyFormat)),
        items: formatItems,
        align: 'end',
    });
    const head = (0, shared_cjs_1.h)('div', { className: 'qqsHead' }, (0, shared_cjs_1.h)('div', null, (0, shared_cjs_1.h)('div', { className: 'qqsTitle' }, 'QQ Chat'), (0, shared_cjs_1.h)('div', { className: 'qqMuted' }, 'QQ Bot 接收、兼容与权限设置')), (0, shared_cjs_1.h)('div', { className: 'qqStatus' }, loading ? '加载中…' : account ? (account.gatewayStatus === 'online' ? '已连接' : '已授权') : '未连接', account && (0, shared_cjs_1.h)(shared_cjs_1.Button, { size: 'sm', variant: 'outline', disabled: busy, onClick: () => void disconnect() }, '取消连接')));
    if (loading)
        return (0, shared_cjs_1.h)('div', { className: 'qqs' }, head, (0, shared_cjs_1.h)('div', { className: 'qqMuted' }, '正在读取 QQ Chat 设置…'));
    if (!account) {
        const modeButtons = (0, shared_cjs_1.h)('div', { className: 'qqChoiceButtons' }, (0, shared_cjs_1.h)(shared_cjs_1.Button, { size: 'sm', variant: connectionMode === 'qr' ? 'primary' : 'outline', onClick: () => { setConnectionMode('qr'); setError(''); } }, '扫码连接'), (0, shared_cjs_1.h)(shared_cjs_1.Button, { size: 'sm', variant: connectionMode === 'manual' ? 'primary' : 'outline', onClick: () => { setConnectionMode('manual'); setAuth(null); setError(''); } }, '手动配置'));
        const qrBody = (0, shared_cjs_1.h)('div', { className: 'qqConnect' }, (0, shared_cjs_1.h)('div', { className: 'qqsTitle' }, auth ? '使用 QQ 扫码授权' : '连接 QQ Bot'), (0, shared_cjs_1.h)('div', { className: 'qqMuted' }, '使用手机 QQ 扫描官方 Bot 授权二维码。扫码和凭据解密都在 DSH Host 侧完成。'), auth && (0, shared_cjs_1.h)('div', { className: 'qqQr' }, (0, shared_cjs_1.h)('img', { src: auth.qrDataUrl, alt: 'QQ 授权二维码' })), (0, shared_cjs_1.h)(shared_cjs_1.Button, { variant: 'primary', disabled: busy, onClick: () => void startAuth() }, auth ? '重新生成二维码' : '生成二维码'));
        const manualBody = (0, shared_cjs_1.h)('div', { className: 'qqConnect qqManualConnect' }, (0, shared_cjs_1.h)('div', { className: 'qqsTitle' }, '手动配置 QQ Bot'), (0, shared_cjs_1.h)('div', { className: 'qqMuted' }, '填写 QQ 开放平台创建的 AppID 和 AppSecret。密钥只提交到 DSH Host，不会显示在会话或日志中。'), (0, shared_cjs_1.h)(shared_cjs_1.Input, { value: manualAppId, placeholder: 'AppID', onChange: (event) => setManualAppId(event.target.value) }), (0, shared_cjs_1.h)(shared_cjs_1.Input, { type: 'password', value: manualAppSecret, placeholder: 'AppSecret', onChange: (event) => setManualAppSecret(event.target.value) }), (0, shared_cjs_1.h)('label', { className: 'qqCheckRow' }, (0, shared_cjs_1.h)('input', { type: 'checkbox', checked: manualSandbox, onChange: (event) => setManualSandbox(event.target.checked) }), (0, shared_cjs_1.h)('span', null, '使用沙箱环境')), (0, shared_cjs_1.h)(shared_cjs_1.Button, { variant: 'primary', disabled: busy || !manualAppId.trim() || !manualAppSecret.trim(), onClick: () => void connectManual() }, busy ? '验证并连接中…' : '验证并连接'));
        return (0, shared_cjs_1.h)('div', { className: 'qqs' }, head, error && (0, shared_cjs_1.h)('div', { className: 'qqError' }, error), modeButtons, connectionMode === 'qr' ? qrBody : manualBody);
    }
    if (!settings)
        return (0, shared_cjs_1.h)('div', { className: 'qqs' }, head, (0, shared_cjs_1.h)('div', { className: 'qqMuted' }, '正在读取设置…'));
    const receiveButtons = (0, shared_cjs_1.h)('div', { className: 'qqChoiceButtons' }, ...['auto', 'mention', 'silent'].map(mode => (0, shared_cjs_1.h)(shared_cjs_1.Button, {
        key: mode,
        size: 'sm',
        variant: settings.groupReceiveMode === mode ? 'primary' : 'outline',
        onClick: () => void patch({ groupReceiveMode: mode }),
    }, mode === 'auto' ? '自动回应' : mode === 'mention' ? '@回复' : '静默记录')));
    const receiveHelp = (0, shared_cjs_1.h)(shared_cjs_1.Menu, {
        open: receiveHelpOpen,
        onClose: () => setReceiveHelpOpen(false),
        onSelect: () => undefined,
        portal: true,
        align: 'end',
        items: [
            { type: 'label', id: 'receive-help-title', text: '开启全量消息接收' },
            { type: 'label', id: 'receive-help-step-1', text: '1. 手机端 QQ 打开机器人所在的群' },
            { type: 'label', id: 'receive-help-step-2', text: '2. 点击机器人的头像进入资料页' },
            { type: 'label', id: 'receive-help-step-3', text: '3. 点击右上角「设置」' },
            { type: 'label', id: 'receive-help-step-4', text: '4. 打开「全量消息接收」' },
        ],
        footer: [{ type: 'label', id: 'receive-help-note', text: '未开启时只能收到 @ 消息，非 @ 消息不会进入会话记录' }],
        anchor: (0, shared_cjs_1.h)(shared_cjs_1.Button, { size: 'sm', variant: 'outline', onClick: () => setReceiveHelpOpen(!receiveHelpOpen) }, '设置方法'),
    });
    const receiveGroup = (0, shared_cjs_1.h)('div', { className: 'qqSettingsGroup' }, (0, shared_cjs_1.h)('h3', null, '消息接收'), (0, shared_cjs_1.h)('div', { className: 'qqSetting' }, (0, shared_cjs_1.h)('div', null, (0, shared_cjs_1.h)('div', { className: 'qqSettingTitle' }, '群聊接收方式'), (0, shared_cjs_1.h)('div', { className: 'qqSettingHelp qqHelpRow' }, '自动回应：每条群消息都会触发 Agent；@回复：所有消息都记录，但只有 @Bot 才唤醒 Agent；静默记录：只记录群聊与记忆，不主动回应。', receiveHelp)), (0, shared_cjs_1.h)('div', { className: 'qqControl' }, receiveButtons)), (0, shared_cjs_1.h)('div', { className: 'qqSetting' }, (0, shared_cjs_1.h)('div', null, (0, shared_cjs_1.h)('div', { className: 'qqSettingTitle' }, '群聊消息兼容格式'), (0, shared_cjs_1.h)('div', { className: 'qqSettingHelp' }, '仅控制发送到 QQ 群聊时使用的消息格式。')), (0, shared_cjs_1.h)('div', { className: 'qqControl' }, groupReplyPicker)), (0, shared_cjs_1.h)('div', { className: 'qqSetting' }, (0, shared_cjs_1.h)('div', null, (0, shared_cjs_1.h)('div', { className: 'qqSettingTitle' }, '私聊消息兼容格式'), (0, shared_cjs_1.h)('div', { className: 'qqSettingHelp' }, '仅控制发送到 QQ 私聊时使用的消息格式。')), (0, shared_cjs_1.h)('div', { className: 'qqControl' }, directReplyPicker)), (0, shared_cjs_1.h)('div', { className: 'qqSetting' }, (0, shared_cjs_1.h)('label', { className: 'qqCheckRow' }, (0, shared_cjs_1.h)('input', {
        type: 'checkbox',
        checked: settings.directStreamingEnabled && settings.directReplyFormat !== 'compat',
        disabled: settings.directReplyFormat === 'compat',
        onChange: (event) => void patch({ directStreamingEnabled: event.target.checked }),
    }), (0, shared_cjs_1.h)('span', null, (0, shared_cjs_1.h)('div', { className: 'qqSettingTitle' }, '私聊流式回复'), (0, shared_cjs_1.h)('div', { className: 'qqSettingHelp' }, settings.directReplyFormat === 'compat'
        ? '纯文本兼容模式不支持流式传输，已自动关闭。'
        : settings.directStreamingEnabled
            ? '使用 QQ 官方流式接口逐步更新私聊回复；部分 QQ 客户端可能看不到流式效果。'
            : '使用普通一次性消息发送，兼容性更好。')))));
    const memoryGroup = (0, shared_cjs_1.h)('div', { className: 'qqSettingsGroup' }, (0, shared_cjs_1.h)('h3', null, '记忆系统'), (0, shared_cjs_1.h)('div', { className: 'qqSetting' }, (0, shared_cjs_1.h)('div', null, (0, shared_cjs_1.h)('div', { className: 'qqSettingTitle' }, '启用记忆系统'), (0, shared_cjs_1.h)('div', { className: 'qqSettingHelp' }, '记忆会在新 Session、上下文 TTL 过期、记忆变化或 Session 压缩后刷新，不会每轮重复注入完整上下文；后台会在空闲时整理近期消息。启用记忆可能降低上下文缓存命中率并增加输入 token。关闭后停止记忆注入和后台整理，但不会删除已有记忆。')), (0, shared_cjs_1.h)('div', { className: 'qqControl' }, (0, shared_cjs_1.h)(shared_cjs_1.Button, { size: 'sm', variant: settings.memoryEnabled ? 'primary' : 'outline', onClick: () => void patch({ memoryEnabled: !settings.memoryEnabled }) }, settings.memoryEnabled ? '已启用' : '已关闭'))));
    const ownerSetting = !settings.groupMembersCanUseTools
        ? (0, shared_cjs_1.h)('div', { className: 'qqSetting' }, (0, shared_cjs_1.h)('div', null, (0, shared_cjs_1.h)('div', { className: 'qqSettingTitle' }, 'Owner stable ID'), (0, shared_cjs_1.h)('div', { className: 'qqSettingHelp' }, '使用 stable sender ID，不根据昵称判断。')), (0, shared_cjs_1.h)('div', { className: 'qqControl' }, (0, shared_cjs_1.h)(shared_cjs_1.Input, {
            value: settings.ownerUserId,
            placeholder: '粘贴 stable ID',
            onChange: (event) => setSettings({ ...settings, ownerUserId: event.target.value }),
            onBlur: (event) => void patch({ ownerUserId: event.currentTarget.value }),
        }), ownerPicker))
        : null;
    const toolsGroup = (0, shared_cjs_1.h)('div', { className: 'qqSettingsGroup' }, (0, shared_cjs_1.h)('h3', null, '工具权限'), (0, shared_cjs_1.h)('div', { className: 'qqSetting' }, (0, shared_cjs_1.h)('label', { className: 'qqCheckRow' }, (0, shared_cjs_1.h)('input', { type: 'checkbox', checked: settings.groupMembersCanUseTools, onChange: (event) => void patch({ groupMembersCanUseTools: event.target.checked }) }), (0, shared_cjs_1.h)('span', null, (0, shared_cjs_1.h)('div', { className: 'qqSettingTitle' }, '群成员可用工具'), (0, shared_cjs_1.h)('div', { className: 'qqSettingHelp' }, settings.groupMembersCanUseTools ? '群友触发的 Agent 回合可以使用当前 preset 的全部工具。' : '关闭后只有 Owner 触发的群聊回合可以执行工具；其他群友仍可正常聊天，但工具调用会被拒绝。')))), ownerSetting);
    const mediaGroup = (0, shared_cjs_1.h)('div', { className: 'qqSettingsGroup' }, (0, shared_cjs_1.h)('h3', null, '媒体与文件权限'), (0, shared_cjs_1.h)('div', { className: 'qqSetting' }, (0, shared_cjs_1.h)('label', { className: 'qqCheckRow' }, (0, shared_cjs_1.h)('input', { type: 'checkbox', checked: settings.groupMembersCanReceiveMedia, onChange: (event) => void patch({ groupMembersCanReceiveMedia: event.target.checked }) }), (0, shared_cjs_1.h)('span', null, (0, shared_cjs_1.h)('div', { className: 'qqSettingTitle' }, '接收群成员媒体/文件'), (0, shared_cjs_1.h)('div', { className: 'qqSettingHelp' }, settings.groupMembersCanReceiveMedia ? '下载并在会话中显示群成员发送的图片、文件、音频和视频。' : '群成员发送的媒体不会下载、存储或注入会话；Owner 和私聊不受影响。')))), (0, shared_cjs_1.h)('div', { className: 'qqSetting' }, (0, shared_cjs_1.h)('label', { className: 'qqCheckRow' }, (0, shared_cjs_1.h)('input', { type: 'checkbox', checked: settings.groupMembersCanReadMedia, onChange: (event) => void patch({ groupMembersCanReadMedia: event.target.checked }) }), (0, shared_cjs_1.h)('span', null, (0, shared_cjs_1.h)('div', { className: 'qqSettingTitle' }, '允许群成员读取媒体/文件'), (0, shared_cjs_1.h)('div', { className: 'qqSettingHelp' }, settings.groupMembersCanReadMedia ? '群成员触发的回合可以调用 QQChat 媒体工具读取当前消息附件。' : '群成员仍可看到已接收的媒体，但不能调用媒体工具读取内容；Owner 和私聊不受影响。')))));
    const diagnosticsGroup = (0, shared_cjs_1.h)('div', { className: 'qqSettingsGroup' }, (0, shared_cjs_1.h)('h3', null, '诊断'), (0, shared_cjs_1.h)('div', { className: 'qqSetting' }, (0, shared_cjs_1.h)('div', null, (0, shared_cjs_1.h)('div', { className: 'qqSettingTitle' }, '插件日志'), (0, shared_cjs_1.h)('div', { className: 'qqSettingHelp' }, account.gatewayLastError ? `最近网关错误：${account.gatewayLastError}` : '查看 QQ Gateway、授权、Agent bridge 与消息发送的最近日志。')), (0, shared_cjs_1.h)(shared_cjs_1.Button, { size: 'sm', variant: 'outline', onClick: () => void openLogs() }, '查看日志')));
    return (0, shared_cjs_1.h)('div', { className: 'qqs' }, head, error && (0, shared_cjs_1.h)('div', { className: 'qqError' }, error), receiveGroup, memoryGroup, mediaGroup, toolsGroup, diagnosticsGroup, logs && (0, shared_cjs_1.h)(shared_cjs_1.Modal, { title: 'QQ Chat 日志', onClose: () => setLogs(null) }, logs.length ? logs.map(log => (0, shared_cjs_1.h)('div', { key: log.id, className: `qqLog ${log.level}` }, (0, shared_cjs_1.h)('span', { className: 'qqLogMeta' }, `${(0, shared_cjs_1.dateTime)(log.time)} [${log.level}]`), log.message)) : (0, shared_cjs_1.h)('div', { className: 'qqMuted' }, '暂无日志。')));
}

},
"./shared.cjs": function(module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dateTime = exports.time = exports.initials = exports.short = exports.CHANNEL = exports.h = exports.useSyncExternalStore = exports.useState = exports.useMemo = exports.useEffect = exports.useCallback = exports.Menu = exports.Input = exports.Button = exports.React = void 0;
exports.setQQRpc = setQQRpc;
exports.getQQRpc = getQQRpc;
exports.installQQSettingsIcon = installQQSettingsIcon;
exports.installStyles = installStyles;
exports.call = call;
exports.Modal = Modal;
exports.React = require('react');
const dshPrimitives = require('@deepseek-ai/dsh-client-ui-primitives');
const { Button: DshButton, Input: DshInput, Menu: DshMenu, Modal: DshModal } = dshPrimitives;
exports.Button = DshButton;
exports.Input = DshInput;
exports.Menu = DshMenu;
exports.useCallback = exports.React.useCallback, exports.useEffect = exports.React.useEffect, exports.useMemo = exports.React.useMemo, exports.useState = exports.React.useState, exports.useSyncExternalStore = exports.React.useSyncExternalStore;
exports.h = exports.React.createElement;
let qqRpc;
function setQQRpc(rpc) { qqRpc = rpc; }
function getQQRpc() { return qqRpc; }
exports.CHANNEL = '/qqchat';
const STYLE_ID = 'dsh-qqchat/client-ui-v2';
const QQ_ICON_PATH = 'M17.5359 12.5144L16.8402 10.7175C16.8408 10.6968 16.8494 10.3429 16.8494 10.1604C16.8494 7.08792 15.448 4.0003 12.0012 4C8.55459 4.0003 7.15292 7.08792 7.15292 10.1604C7.15292 10.3429 7.16151 10.6968 7.16209 10.7175L6.4667 12.5144C6.27608 13.0285 6.08776 13.564 5.94988 14.0232C5.29262 16.2126 5.50559 17.1186 5.66783 17.139C6.01581 17.1823 7.02221 15.4908 7.02221 15.4908C7.02221 16.4704 7.5095 17.7487 8.56405 18.6719C8.16963 18.7976 7.68635 18.9911 7.37564 19.2284C7.09645 19.442 7.13142 19.6594 7.18158 19.7473C7.40258 20.1329 10.9713 19.9935 12.0017 19.8733C13.0319 19.9935 16.6009 20.1329 16.8216 19.7473C16.872 19.6594 16.9067 19.442 16.6275 19.2284C16.3168 18.9911 15.8333 18.7976 15.4386 18.6716C16.4928 17.7487 16.9801 16.4704 16.9801 15.4908C16.9801 15.4908 17.9868 17.1823 18.3348 17.139C18.4967 17.1186 18.7131 16.2108 18.0524 14.0232C17.9125 13.56 17.7265 13.0285 17.5359 12.5144ZM18.5574 20.7407C18.1843 21.3926 17.7237 21.6334 17.1187 21.7981C16.8792 21.8633 16.621 21.9056 16.325 21.936C15.8844 21.9814 15.3392 22.001 14.712 22C13.786 21.9985 12.693 21.9491 12.0017 21.884C11.3103 21.9491 10.2173 21.9985 9.29129 22C8.66414 22.001 8.11889 21.9814 7.67832 21.936C7.38236 21.9056 7.12409 21.8633 6.88467 21.7981C6.27994 21.6335 5.81954 21.393 5.44496 20.7393C5.15165 20.2258 5.07747 19.6406 5.20612 19.0866C4.61376 18.9546 4.20483 18.6045 3.92733 18.1757C3.77911 17.9466 3.68408 17.7127 3.61845 17.4663C3.53001 17.1344 3.49486 16.7666 3.50184 16.3601C3.51532 15.5749 3.68902 14.5984 4.03435 13.4481C4.17427 12.9821 4.3614 12.4396 4.6015 11.7926L5.15467 10.3632C5.1536 10.287 5.15292 10.2154 5.15292 10.1604C5.15292 5.6047 7.58875 2.00038 12.0013 2C16.4138 2.00038 18.8494 5.60454 18.8494 10.1604C18.8494 10.2154 18.8487 10.2869 18.8477 10.3631L19.401 11.7923L19.4112 11.8191C19.636 12.4254 19.8242 12.9722 19.967 13.445C20.3145 14.5956 20.4889 15.5735 20.5018 16.361C20.5085 16.768 20.4728 17.1365 20.3837 17.4689C20.3178 17.7148 20.2228 17.9483 20.0746 18.1768C19.7976 18.6041 19.3905 18.9532 18.7974 19.0862C18.9266 19.6411 18.8523 20.2274 18.5574 20.7407Z';
/** Temporarily replaces DSH's fallback settings glyph for the QQ Chat row. */
function installQQSettingsIcon() {
    const originals = new Map();
    const apply = () => {
        for (const button of Array.from(document.querySelectorAll('button'))) {
            const label = button.querySelector('span[class$="_navLabel"]');
            if (label?.textContent?.trim() !== 'QQ Chat')
                continue;
            if (button.querySelector('[data-dsh-qqchat-icon]'))
                continue;
            const icon = button.querySelector('svg[class$="_navIcon"]');
            if (!icon)
                continue;
            originals.set(button, icon.cloneNode(true));
            icon.remove();
            const replacement = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            replacement.setAttribute('width', '16');
            replacement.setAttribute('height', '16');
            replacement.setAttribute('viewBox', '0 0 24 24');
            replacement.setAttribute('fill', 'currentColor');
            replacement.setAttribute('aria-hidden', 'true');
            replacement.setAttribute('data-dsh-qqchat-icon', 'true');
            replacement.classList.add('dsh-qqchat-nav-icon');
            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('d', QQ_ICON_PATH);
            replacement.append(path);
            button.insertBefore(replacement, label);
        }
    };
    const observer = new MutationObserver(apply);
    observer.observe(document.body, { childList: true, subtree: true });
    apply();
    return () => {
        observer.disconnect();
        for (const [button, original] of originals) {
            const replacement = button.querySelector('[data-dsh-qqchat-icon]');
            if (replacement)
                replacement.replaceWith(original);
        }
        originals.clear();
    };
}
const css = `
.qqs{display:flex;flex-direction:column;gap:18px;color:var(--dsw-alias-label-primary);font:inherit}.qqs *{box-sizing:border-box}
.qqsHead{display:flex;align-items:center;justify-content:space-between;gap:12px}.qqsBrand{display:flex;align-items:center;gap:10px}.qqsLogo{width:34px;height:34px;border-radius:10px;display:grid;place-items:center;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);font-weight:700}.qqsTitle{font-size:15px;font-weight:620}.qqMuted{font-size:12px;color:var(--dsw-alias-label-secondary);line-height:1.55}.qqStatus{display:flex;align-items:center;gap:7px;font-size:12px;color:var(--dsw-alias-label-secondary)}.qqDot{width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-state-warn-primary)}.qqDot.online{background:var(--dsw-alias-state-success-primary)}
.qqCard{border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1);overflow:hidden}.qqCardHead{padding:12px 14px;border-bottom:1px solid var(--dsw-alias-border-l1);font-size:13px;font-weight:600}.qqSetting{display:flex;align-items:flex-start;justify-content:space-between;gap:18px;padding:13px 14px;border-bottom:1px solid var(--dsw-alias-border-l1)}.qqSetting:last-child{border-bottom:0}.qqSettingTitle{font-size:13px}.qqSettingHelp{font-size:11px;color:var(--dsw-alias-label-secondary);margin-top:4px;line-height:1.5;max-width:470px}.qqControl{min-width:190px;display:flex;justify-content:flex-end;align-items:center;gap:8px}.qqSelect,.qqInput{font:inherit;font-size:12px;color:inherit;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:7px 9px;outline:none}.qqInput{width:250px}.qqSelect{min-width:180px}.qqSwitch{position:relative;width:38px;height:22px;border:0;border-radius:999px;background:var(--dsw-alias-bg-overlay);cursor:pointer}.qqSwitch.on{background:var(--dsw-alias-brand-primary)}.qqSwitch:after{content:'';position:absolute;width:16px;height:16px;border-radius:50%;top:3px;left:3px;background:var(--dsw-alias-bg-base);transition:transform .15s}.qqSwitch.on:after{transform:translateX(16px)}
.qqSegment{display:flex;padding:2px;border:1px solid var(--dsw-alias-border-l1);border-radius:9px;background:var(--dsw-alias-bg-base)}.qqSegment button{font:inherit;font-size:11px;border:0;background:transparent;color:var(--dsw-alias-label-secondary);padding:6px 9px;border-radius:6px;cursor:pointer;white-space:nowrap}.qqSegment button.active{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.qqBtn{font:inherit;font-size:12px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:inherit;border-radius:8px;padding:7px 11px;cursor:pointer}.qqBtn:hover{background:var(--dsw-alias-bg-layer-2)}.qqBtn.primary{background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-bg-base);border-color:transparent}.qqBtn:disabled{opacity:.45;cursor:default}.qqError{font-size:12px;color:var(--dsw-alias-state-error-primary)}
.qqConnect{padding:24px;display:flex;flex-direction:column;align-items:center;gap:14px;text-align:center}.qqQr{padding:14px;background:#fff;border-radius:14px}.qqQr img{display:block;width:210px;height:210px}
.qqModalMask{position:fixed;inset:0;z-index:10000;background:#0007;display:grid;place-items:center;padding:24px}.qqModal{width:min(720px,calc(100vw - 40px));max-height:min(760px,calc(100vh - 40px));display:flex;flex-direction:column;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:14px;box-shadow:0 16px 60px #0007;overflow:hidden}.qqModalHead{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:13px 15px;border-bottom:1px solid var(--dsw-alias-border-l1)}.qqModalTitle{font-size:14px;font-weight:620}.qqModalBody{overflow:auto;padding:14px}.qqClose{border:0;background:transparent;color:inherit;font-size:18px;cursor:pointer}
.qqLog{font:11px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace;padding:7px 0;border-bottom:1px solid var(--dsw-alias-border-l1);white-space:pre-wrap;word-break:break-word}.qqLogMeta{opacity:.65;margin-right:8px}.qqLog.warn{color:var(--dsw-alias-state-warn-primary)}.qqLog.error{color:var(--dsw-alias-state-error-primary)}
.qqFootButton{border:0;background:transparent;color:var(--dsw-alias-label-secondary);height:36px;border-radius:8px;display:flex;align-items:center;justify-content:center;gap:8px;padding:0 10px;cursor:pointer;font:inherit;font-size:12px}.qqFootButton:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}.qqFootIcon{width:20px;height:20px;border-radius:6px;display:grid;place-items:center;font-size:10px;font-weight:700;border:1px solid var(--dsw-alias-border-l2)}
.qqChatToolbar{display:flex;gap:8px;margin-bottom:12px}.qqSearch{flex:1;font:inherit;background:var(--dsw-alias-bg-base);color:inherit;border:1px solid var(--dsw-alias-border-l2);border-radius:9px;padding:8px 10px}.qqChatSection{margin:14px 0 6px;font-size:11px;color:var(--dsw-alias-label-secondary)}.qqChatRow{width:100%;display:flex;align-items:center;gap:10px;padding:10px;border:0;background:transparent;color:inherit;border-radius:9px;text-align:left;cursor:pointer}.qqChatRow:hover{background:var(--dsw-alias-bg-layer-2)}.qqAvatar{width:34px;height:34px;border-radius:50%;display:grid;place-items:center;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);font-size:11px;font-weight:650;flex:0 0 auto}.qqGrow{min-width:0;flex:1}.qqEllipsis{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.qqBadge{font-size:10px;padding:2px 5px;border-radius:5px;background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-secondary)}
.qqTranscript{display:flex;gap:9px;align-items:flex-start;margin:14px 0}.qqTranscript.out{flex-direction:row-reverse}.qqTranscriptBody{max-width:min(78%,680px)}.qqTranscript.out .qqTranscriptBody{text-align:right}.qqTranscriptMeta{font-size:11px;color:var(--dsw-alias-label-secondary);margin:0 3px 5px}.qqBubble{display:inline-block;text-align:left;white-space:pre-wrap;word-break:break-word;font-size:13px;line-height:1.55;padding:9px 11px;border-radius:5px 13px 13px 13px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1)}.qqTranscript.out .qqBubble{border-radius:13px 5px 13px 13px;background:var(--dsw-static-deepseek-50,var(--dsw-alias-bg-layer-2))}.qqQuote{max-width:100%;margin:0 0 7px;padding:7px 10px 8px;border:1px solid var(--dsw-alias-border-l1);border-left:3px solid var(--dsw-alias-brand-primary);border-radius:8px;background:color-mix(in srgb,var(--dsw-alias-bg-layer-2) 72%,transparent);color:var(--dsw-alias-label-secondary);text-align:left;white-space:normal;word-break:break-word;overflow:hidden}.qqQuoteLabel{margin-bottom:3px;font-size:10px;line-height:14px;font-weight:650;color:var(--dsw-alias-brand-primary);letter-spacing:.02em}.qqQuoteText{font-size:12px;line-height:1.5;white-space:pre-wrap;display:-webkit-box;-webkit-line-clamp:8;-webkit-box-orient:vertical;overflow:hidden}.qqTranscript.out .qqQuote{border-left:1px solid var(--dsw-alias-border-l1);border-right:3px solid var(--dsw-alias-brand-primary)}
.qqHeaderButton{font:inherit;font-size:11px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);border-radius:7px;padding:5px 8px;cursor:pointer}
.qqMemoryGrid{display:grid;grid-template-columns:1fr 1fr;gap:10px}.qqMemoryCard{border:1px solid var(--dsw-alias-border-l1);border-radius:9px;overflow:hidden}.qqMemoryCard h4{font-size:11px;margin:0;padding:8px 9px;border-bottom:1px solid var(--dsw-alias-border-l1)}.qqMemoryDoc{padding:9px;font-size:11px;line-height:1.55;color:var(--dsw-alias-label-secondary);white-space:pre-wrap;word-break:break-word;max-height:180px;overflow:auto}.qqMemberList{margin-top:12px}.qqMemberRow{display:flex;align-items:center;gap:8px;padding:8px;border-bottom:1px solid var(--dsw-alias-border-l1);font-size:12px}.qqMemberId{font:10px ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--dsw-alias-label-secondary)}
@media(max-width:720px){.qqSetting{flex-direction:column}.qqControl{width:100%;justify-content:flex-start}.qqMemoryGrid{grid-template-columns:1fr}.qqInput{width:100%}}

/* QQChat contributes layout only; controls, dialogs and selection surfaces are
   DSH primitives. Message colors use the host token system directly. */
.qqs{display:block;width:100%;min-width:0}.qqsHead{width:100%}.qqSettingsGroup{display:block;width:100%;min-width:0;margin-top:22px}.qqSettingsGroup h3{margin:0 0 8px;font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary)}.qqSettingsGroup .qqSetting{display:flex;width:100%;min-width:0;flex:0 0 auto;padding:12px 0;border-bottom:1px solid var(--dsw-alias-border-l1)}.qqSettingsGroup .qqSetting:last-child{border-bottom:0}.qqSetting>div:first-child{flex:1 1 auto;min-width:0}.qqControl{flex:0 0 auto}.qqChoiceButtons{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:6px}.qqSettingsGroup select{font:inherit;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:5px 8px}.qqCheckRow{display:flex;align-items:flex-start;gap:10px;cursor:pointer}.qqCheckRow input{flex:none;width:16px;height:16px;margin:2px 0 0;accent-color:var(--dsw-alias-button-primary-fill);cursor:pointer}.qqConnect{display:flex;flex-direction:column;align-items:center;gap:14px;padding:24px 0;text-align:center}.qqTranscript{margin:16px 0}.qqTranscriptBody{max-width:min(78%,680px)}.qqBubble{border:0;border-radius:18px;padding:9px 13px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}.qqTranscript.out .qqBubble{border-radius:18px;background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground)}.qqTranscriptMeta{margin:0 4px 4px;font-size:12px;color:var(--dsw-alias-label-secondary)}.qqQuote{border-color:var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1)}
.qqWideModal{width:min(760px,calc(100vw - 48px));max-height:calc(100vh - 48px);min-height:0;overflow:hidden}.qqModalContent{min-height:0;overflow:auto}.qqModalContent .qqMemoryGrid{min-width:0}.qqModalContent .qqLog{overflow-wrap:anywhere;word-break:break-word}
`.concat('.qqQuoteSender{margin-top:4px;font-size:10px;color:var(--dsw-alias-label-secondary)}.qqMediaList{display:flex;flex-wrap:wrap;gap:6px;margin-top:7px}.qqMediaCard{display:flex;align-items:center;gap:6px;max-width:100%;padding:6px 8px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1);font-size:11px}.qqMediaKind{color:var(--dsw-alias-brand-primary);font-weight:650}.qqMediaPreview{width:42px;height:42px;object-fit:cover;border-radius:6px}.qqMediaName{max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.qqMediaSize,.qqMediaQuoted{color:var(--dsw-alias-label-secondary)}');
const qqThemeOverrides = '.qqBubble{background:var(--dsw-specific-bubble);color:var(--dsw-alias-label-primary)}.qqTranscript.out .qqBubble{background:var(--dsw-specific-bubble);color:var(--dsw-alias-label-primary)}';
function installStyles() {
    if (typeof document === 'undefined' || document.querySelector(`style[data-plugin-css="${STYLE_ID}"]`))
        return () => { };
    const node = document.createElement('style');
    node.dataset.pluginCss = STYLE_ID;
    node.textContent = css + qqThemeOverrides;
    document.head.appendChild(node);
    return () => node.remove();
}
async function call(rpc, endpoint, payload = {}) {
    const result = await rpc.call(exports.CHANNEL, endpoint, payload);
    if (!result.ok)
        throw new Error(result.error?.message || 'QQ Chat 请求失败');
    return result.value;
}
const short = (value) => value.length > 10 ? `…${value.slice(-10)}` : value;
exports.short = short;
const initials = (value) => String(value || '?').trim().slice(0, 2).toUpperCase();
exports.initials = initials;
const time = (value) => value ? new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
exports.time = time;
const dateTime = (value) => value ? new Date(value).toLocaleString() : '';
exports.dateTime = dateTime;
function Modal({ title, onClose, children }) {
    return (0, exports.h)(DshModal, { open: true, title, onClose, closeLabel: '关闭', className: 'qqWideModal', contentClassName: 'qqModalContent' }, children);
}

},
"./workspace.cjs": function(module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.QQTranscriptNode = QQTranscriptNode;
exports.MemoryCard = MemoryCard;
exports.QQSessionUtility = QQSessionUtility;
exports.createQQMessageDefinition = createQQMessageDefinition;
const shared_cjs_1 = require("./shared.cjs");
function formatBytes(value) {
    if (!value || value < 1024)
        return `${value || 0} B`;
    if (value < 1024 * 1024)
        return `${(value / 1024).toFixed(1)} KB`;
    return `${(value / 1024 / 1024).toFixed(1)} MB`;
}
function AttachmentCards({ attachments, sessionId }) {
    if (!attachments?.length)
        return null;
    const rpc = (0, shared_cjs_1.getQQRpc)();
    const [previews, setPreviews] = (0, shared_cjs_1.useState)({});
    (0, shared_cjs_1.useEffect)(() => {
        if (!rpc || !sessionId)
            return;
        let cancelled = false;
        void Promise.all(attachments.filter(item => item.kind === 'image').map(async (item) => {
            try {
                const result = await (0, shared_cjs_1.call)(rpc, 'attachment/read', { sessionId, attachmentId: item.id });
                return result.dataUrl ? [item.id, result.dataUrl] : null;
            }
            catch {
                return null;
            }
        })).then(items => {
            if (cancelled)
                return;
            setPreviews(current => ({ ...current, ...Object.fromEntries(items.filter((item) => Boolean(item))) }));
        });
        return () => { cancelled = true; };
    }, [attachments, rpc, sessionId]);
    return (0, shared_cjs_1.h)('div', { className: 'qqMediaList' }, ...attachments.map(attachment => (0, shared_cjs_1.h)('div', { className: 'qqMediaCard', key: `${attachment.id}:${attachment.quoted ? 'quote' : 'own'}` }, (0, shared_cjs_1.h)('span', { className: 'qqMediaKind' }, attachment.kind === 'image' ? '图片' : attachment.kind === 'video' ? '视频' : attachment.kind === 'voice' || attachment.kind === 'audio' ? '语音' : '文件'), previews[attachment.id] ? (0, shared_cjs_1.h)('img', { className: 'qqMediaPreview', src: previews[attachment.id], alt: attachment.filename }) : null, (0, shared_cjs_1.h)('span', { className: 'qqMediaName' }, attachment.filename), (0, shared_cjs_1.h)('span', { className: 'qqMediaSize' }, formatBytes(attachment.sizeBytes)), attachment.quoted ? (0, shared_cjs_1.h)('span', { className: 'qqMediaQuoted' }, '引用') : null)));
}
function QQTranscriptNode({ node }) {
    const data = node.data;
    const outbound = data.direction === 'outbound' || data.isOwner === true;
    const hasQuote = Boolean(data.quote) || Boolean(data.quotedText);
    const quoteText = data.quote?.text || data.quotedText || '';
    return (0, shared_cjs_1.h)('div', { className: `qqTranscript${outbound ? ' out' : ''}` }, (0, shared_cjs_1.h)('div', { className: 'qqTranscriptBody' }, !data.isOwner && (0, shared_cjs_1.h)('div', { className: 'qqTranscriptMeta' }, data.senderName || (outbound ? 'Owner' : 'QQ 用户'), ' · ', (0, shared_cjs_1.time)(data.createdAt)), hasQuote && (0, shared_cjs_1.h)('div', { className: 'qqQuote', title: quoteText }, (0, shared_cjs_1.h)('div', { className: 'qqQuoteLabel' }, '引用消息'), quoteText ? (0, shared_cjs_1.h)('div', { className: 'qqQuoteText' }, quoteText) : null, data.quote?.senderName ? (0, shared_cjs_1.h)('div', { className: 'qqQuoteSender' }, data.quote.senderName) : null, (0, shared_cjs_1.h)(AttachmentCards, { attachments: data.quote?.attachments, sessionId: data.sessionId })), (0, shared_cjs_1.h)('div', { className: 'qqBubble' }, data.content), (0, shared_cjs_1.h)(AttachmentCards, { attachments: data.attachments, sessionId: data.sessionId })));
}
function MemoryCard({ title, value }) {
    return (0, shared_cjs_1.h)('section', { className: 'qqMemoryCard' }, (0, shared_cjs_1.h)('h4', null, title), (0, shared_cjs_1.h)('div', { className: 'qqMemoryDoc' }, value || '还没有形成这部分记忆。'));
}
function MemberMemory({ member, onBack }) {
    return (0, shared_cjs_1.h)(shared_cjs_1.React.Fragment, null, (0, shared_cjs_1.h)('div', { style: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 } }, (0, shared_cjs_1.h)(shared_cjs_1.Button, { size: 'sm', variant: 'outline', onClick: onBack }, '返回群记忆'), (0, shared_cjs_1.h)('div', { className: 'qqGrow' }, (0, shared_cjs_1.h)('div', { className: 'qqsTitle' }, member.displayName || '群友'), (0, shared_cjs_1.h)('div', { className: 'qqMemberId' }, member.platformUserId))), (0, shared_cjs_1.h)('div', { className: 'qqMemoryGrid' }, (0, shared_cjs_1.h)(MemoryCard, { title: '成员画像 · profile', value: member.memory.profile }), (0, shared_cjs_1.h)(MemoryCard, { title: '行为模式 · pattern', value: member.memory.pattern }), (0, shared_cjs_1.h)(MemoryCard, { title: '成员摘要 · summary', value: member.memory.summary }), (0, shared_cjs_1.h)(MemoryCard, { title: '成员长期记忆 · memory', value: member.memory.memory })));
}
function QQSessionUtility({ sessionId, rpc }) {
    const [info, setInfo] = (0, shared_cjs_1.useState)(null);
    const [open, setOpen] = (0, shared_cjs_1.useState)(false);
    const [selectedMember, setSelectedMember] = (0, shared_cjs_1.useState)(null);
    const isQQSession = String(sessionId).startsWith('qqchat-');
    if (!isQQSession)
        return null;
    const show = async () => {
        try {
            setInfo(await (0, shared_cjs_1.call)(rpc, 'chat/info', { sessionId }));
            setSelectedMember(null);
            setOpen(true);
        }
        catch {
            // Host may still be reconciling a just-created Session.
        }
    };
    const memoryBody = info
        ? selectedMember
            ? (0, shared_cjs_1.h)(MemberMemory, { member: selectedMember, onBack: () => setSelectedMember(null) })
            : (0, shared_cjs_1.h)(shared_cjs_1.React.Fragment, null, (0, shared_cjs_1.h)('div', { className: 'qqMemoryGrid' }, (0, shared_cjs_1.h)(MemoryCard, { title: '画像 · profile', value: info.memory.profile }), (0, shared_cjs_1.h)(MemoryCard, { title: '摘要 · summary', value: info.memory.summary }), info.chatType === 'group'
                ? (0, shared_cjs_1.h)(MemoryCard, { title: '长期记忆 · memory', value: info.memory.memory })
                : (0, shared_cjs_1.h)(MemoryCard, { title: '行为模式 · pattern', value: info.memory.pattern }), info.chatType === 'group'
                ? (0, shared_cjs_1.h)(MemoryCard, { title: '近期沉淀 · daily', value: info.memory.daily })
                : null), info.chatType === 'group'
                ? (0, shared_cjs_1.h)('div', { className: 'qqMemberList' }, (0, shared_cjs_1.h)('div', { className: 'qqChatSection' }, `群友 · ${info.members.length} · 点击查看成员记忆`), ...info.members.map(member => (0, shared_cjs_1.h)('button', {
                    type: 'button',
                    key: member.id,
                    className: 'qqMemberRow',
                    onClick: () => setSelectedMember(member),
                    style: { width: '100%', border: 0, background: 'transparent', color: 'inherit', textAlign: 'left', cursor: 'pointer' },
                }, (0, shared_cjs_1.h)('div', { className: 'qqGrow' }, (0, shared_cjs_1.h)('div', null, member.displayName || '群友'), member.aliases?.length ? (0, shared_cjs_1.h)('div', { className: 'qqMemberId' }, `历史昵称：${member.aliases.join('、')}`) : null, member.nicknames?.length ? (0, shared_cjs_1.h)('div', { className: 'qqMemberId' }, `群内称呼：${member.nicknames.join('、')}`) : null), (0, shared_cjs_1.h)('span', { className: 'qqBadge' }, '查看记忆'))))
                : null)
        : null;
    return (0, shared_cjs_1.h)(shared_cjs_1.React.Fragment, null, (0, shared_cjs_1.h)(shared_cjs_1.Button, { size: 'sm', variant: 'outline', onClick: () => void show() }, 'QQ 记忆'), open && info
        ? (0, shared_cjs_1.h)(shared_cjs_1.Modal, {
            title: selectedMember
                ? `${selectedMember.displayName || '群友'} · 成员记忆`
                : info.chatType === 'group' ? `${info.title} · 群记忆` : `${info.title} · 用户记忆`,
            onClose: () => { setOpen(false); setSelectedMember(null); },
        }, memoryBody)
        : null);
}
function createQQMessageDefinition() {
    return {
        kind: 'qqchat-message',
        target: 'chat',
        match: (event) => event.type === 'qqchat/message' && event.data
            ? { id: event.data.messageId, role: 'start' }
            : null,
        start: (_context, match) => match.event.data,
        update: (context) => context.state,
        buildViewNode: (context) => {
            if (!context.state)
                return null;
            const first = context.start ?? context.matches?.[0];
            return {
                key: context.key,
                kind: 'qqchat-message',
                id: context.id,
                target: 'chat',
                anchorSeq: first?.event.seq ?? 0,
                location: first?.location ?? { kind: 'unresolved' },
                visibility: 'visible',
                data: context.state,
            };
        },
    };
}

}
};
var __qqCache = Object.create(null);
function __qqRequire(id) {
  var factory = __qqModules[id];
  if (!factory) return require(id);
  var cached = __qqCache[id];
  if (cached) return cached.exports;
  var module = { exports: {} };
  __qqCache[id] = module;
  factory(module, module.exports, __qqRequire);
  return module.exports;
}
return __qqRequire("./plugin.cjs");
} })
