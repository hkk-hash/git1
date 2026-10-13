import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

type ButtonKind = "pulse" | "toggle";

type ControlButton = {
  id: string;
  name: string;
  kind: ButtonKind;
  message: string;
  onMessage: string;
  offMessage: string;
  tone: "cobalt" | "coral" | "mint" | "violet";
};

type DelayUnit = "seconds" | "minutes" | "hours";
type ActionTiming = "delay" | "clock";

type ChainAction = {
  id: string;
  timing: ActionTiming;
  delayValue: number;
  delayUnit: DelayUnit;
  clockTime: string;
  message: string;
};

type ActionChain = {
  id: string;
  name: string;
  actions: ChainAction[];
};

type ChainRun = {
  token: string;
  status: "waiting" | "sending" | "paused" | "completed" | "error";
  currentIndex: number;
  nextAt: number | null;
  remainingMs: number | null;
  error?: string;
};

type BemfaConfig = {
  privateKey: string;
  publishTopic: string;
  subscribeTopics: string;
  pollSeconds: number;
  rememberKey: boolean;
};

type ReceivedMessage = {
  id: string;
  topic: string;
  message: string;
  time: string;
  unix: number;
};

type Toast = { text: string; type: "success" | "error" } | null;

const API_BASE = "https://apis.bemfa.com/va";
const CONFIG_KEY = "bemfa-console-config-v1";
const BUTTONS_KEY = "bemfa-console-buttons-v1";
const CHAINS_KEY = "bemfa-console-chains-v1";

const defaultConfig: BemfaConfig = {
  privateKey: "",
  publishTopic: "3UU82P0su002",
  subscribeTopics: "3UU82P0su002",
  pollSeconds: 3,
  rememberKey: true,
};

const defaultButtons: ControlButton[] = [
  {
    id: "light-switch",
    name: "照明开关",
    kind: "toggle",
    message: "",
    onMessage: "on",
    offMessage: "off",
    tone: "cobalt",
  },
  {
    id: "buzzer-switch",
    name: "蜂鸣器",
    kind: "toggle",
    message: "",
    onMessage: "bar",
    offMessage: "baroff",
    tone: "coral",
  },
  {
    id: "breath",
    name: "呼吸灯",
    kind: "pulse",
    message: "breath",
    onMessage: "",
    offMessage: "",
    tone: "mint",
  },
  {
    id: "flash-three",
    name: "闪烁 3 次",
    kind: "pulse",
    message: "star3",
    onMessage: "",
    offMessage: "",
    tone: "violet",
  },
];

const emptyButton: ControlButton = {
  id: "",
  name: "",
  kind: "pulse",
  message: "",
  onMessage: "",
  offMessage: "",
  tone: "cobalt",
};

function makeId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function createAction(): ChainAction {
  return {
    id: makeId(),
    timing: "delay",
    delayValue: 30,
    delayUnit: "seconds",
    clockTime: "08:00",
    message: "on",
  };
}

function actionDueAt(action: ChainAction, from: number) {
  if (action.timing === "delay") {
    const multiplier = action.delayUnit === "hours" ? 3_600_000 : action.delayUnit === "minutes" ? 60_000 : 1_000;
    return from + Math.max(0, action.delayValue) * multiplier;
  }

  const [hours, minutes] = action.clockTime.split(":").map(Number);
  const due = new Date(from);
  due.setHours(hours || 0, minutes || 0, 0, 0);
  if (due.getTime() <= from) due.setDate(due.getDate() + 1);
  return due.getTime();
}

function actionTimingLabel(action: ChainAction) {
  if (action.timing === "clock") return `到 ${action.clockTime}`;
  const unit = action.delayUnit === "hours" ? "小时" : action.delayUnit === "minutes" ? "分钟" : "秒";
  return `等待 ${action.delayValue} ${unit}`;
}

function countdownLabel(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}小时 ${minutes}分 ${seconds}秒`;
  if (minutes > 0) return `${minutes}分 ${seconds}秒`;
  return `${seconds}秒`;
}

function getTopicList(value: string) {
  return [...new Set(value.split(/[\s,，]+/).map((item) => item.trim()).filter(Boolean))];
}

async function readJson(response: Response) {
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`网络请求失败（${response.status}）`);
  if (!body || body.code !== 0) {
    throw new Error(body?.message || body?.msg || `巴法云返回错误 ${body?.code ?? "未知"}`);
  }
  return body;
}

export default function App() {
  const [config, setConfig] = useState<BemfaConfig>(defaultConfig);
  const [buttons, setButtons] = useState<ControlButton[]>(defaultButtons);
  const [chains, setChains] = useState<ActionChain[]>([]);
  const [chainRuns, setChainRuns] = useState<Record<string, ChainRun>>({});
  const [toggleStates, setToggleStates] = useState<Record<string, boolean>>({});
  const [editingButton, setEditingButton] = useState<ControlButton | null>(null);
  const [editingChain, setEditingChain] = useState<ActionChain | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [keyVisible, setKeyVisible] = useState(false);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [pressedId, setPressedId] = useState<string | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [isPolling, setIsPolling] = useState(false);
  const [messages, setMessages] = useState<ReceivedMessage[]>([]);
  const [toast, setToast] = useState<Toast>(null);
  const [lastSync, setLastSync] = useState<string>("尚未同步");
  const [now, setNow] = useState(() => Date.now());
  const knownMessages = useRef(new Set<string>());
  const executingChains = useRef(new Set<string>());
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    try {
      const savedConfig = localStorage.getItem(CONFIG_KEY);
      const savedButtons = localStorage.getItem(BUTTONS_KEY);
      const savedChains = localStorage.getItem(CHAINS_KEY);
      if (savedConfig) setConfig((current) => ({ ...current, ...JSON.parse(savedConfig) }));
      if (savedButtons) setButtons(JSON.parse(savedButtons));
      if (savedChains) setChains(JSON.parse(savedChains));
    } catch {
      // Ignore malformed local data and keep the safe defaults.
    }
  }, []);

  useEffect(() => {
    const value = config.rememberKey ? config : { ...config, privateKey: "" };
    localStorage.setItem(CONFIG_KEY, JSON.stringify(value));
  }, [config]);

  useEffect(() => {
    localStorage.setItem(BUTTONS_KEY, JSON.stringify(buttons));
  }, [buttons]);

  useEffect(() => {
    localStorage.setItem(CHAINS_KEY, JSON.stringify(chains));
  }, [chains]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);

  const notify = useCallback((text: string, type: "success" | "error" = "success") => {
    setToast({ text, type });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3200);
  }, []);

  const validateConnection = useCallback(() => {
    if (!config.privateKey.trim()) {
      notify("请先填写巴法云私钥", "error");
      setSettingsOpen(true);
      return false;
    }
    if (!config.publishTopic.trim()) {
      notify("请先填写发布主题", "error");
      setSettingsOpen(true);
      return false;
    }
    return true;
  }, [config.privateKey, config.publishTopic, notify]);

  const publish = useCallback(
    async (message: string) => {
      const response = await fetch(`${API_BASE}/postJsonMsg`, {
        method: "POST",
        headers: { "Content-Type": "application/json;charset=UTF-8" },
        body: JSON.stringify({
          uid: config.privateKey.trim(),
          topic: config.publishTopic.trim(),
          type: 1,
          msg: message,
        }),
      });
      await readJson(response);
    },
    [config.privateKey, config.publishTopic],
  );

  useEffect(() => {
    const tick = () => {
      const currentTime = Date.now();
      Object.entries(chainRuns).forEach(([chainId, run]) => {
        if (run.status !== "waiting" || run.nextAt === null || run.nextAt > currentTime || executingChains.current.has(chainId)) return;
        const chain = chains.find((item) => item.id === chainId);
        const action = chain?.actions[run.currentIndex];
        if (!chain || !action) return;

        executingChains.current.add(chainId);
        setChainRuns((current) => {
          if (current[chainId]?.token !== run.token) return current;
          return { ...current, [chainId]: { ...run, status: "sending", nextAt: null } };
        });

        void publish(action.message)
          .then(() => {
            const nextIndex = run.currentIndex + 1;
            setChainRuns((current) => {
              if (current[chainId]?.token !== run.token) return current;
              if (nextIndex >= chain.actions.length) {
                return { ...current, [chainId]: { ...run, status: "completed", currentIndex: nextIndex, nextAt: null, remainingMs: null } };
              }
              return {
                ...current,
                [chainId]: {
                  ...run,
                  status: "waiting",
                  currentIndex: nextIndex,
                  nextAt: actionDueAt(chain.actions[nextIndex], Date.now()),
                  remainingMs: null,
                },
              };
            });
            if (nextIndex >= chain.actions.length) notify(`${chain.name} · 动作链执行完成`);
          })
          .catch((error) => {
            const message = error instanceof Error ? error.message : "消息发送失败";
            setChainRuns((current) => {
              if (current[chainId]?.token !== run.token) return current;
              return { ...current, [chainId]: { ...run, status: "error", nextAt: null, remainingMs: null, error: message } };
            });
            notify(`${chain.name} · ${message}`, "error");
          })
          .finally(() => executingChains.current.delete(chainId));
      });
    };

    tick();
    const timer = setInterval(tick, 250);
    return () => clearInterval(timer);
  }, [chainRuns, chains, notify, publish]);

  const handleControl = async (button: ControlButton) => {
    if (!validateConnection() || sendingId) return;
    const currentState = toggleStates[button.id] ?? false;
    const nextState = !currentState;
    const message = button.kind === "toggle" ? (nextState ? button.onMessage : button.offMessage) : button.message;

    setPressedId(button.id);
    setTimeout(() => setPressedId(null), 420);
    setSendingId(button.id);
    try {
      await publish(message);
      if (button.kind === "toggle") {
        setToggleStates((current) => ({ ...current, [button.id]: nextState }));
      }
      notify(`${button.name} · 已发送 “${message}”`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "消息发送失败", "error");
    } finally {
      setSendingId(null);
    }
  };

  const pollMessages = useCallback(async () => {
    const topics = getTopicList(config.subscribeTopics);
    if (!config.privateKey.trim() || topics.length === 0) return;
    setIsPolling(true);
    try {
      const results = await Promise.all(
        topics.map(async (topic) => {
          const query = new URLSearchParams({
            uid: config.privateKey.trim(),
            topic,
            type: "1",
            num: "20",
          });
          const response = await fetch(`${API_BASE}/getmsg?${query.toString()}`, { cache: "no-store" });
          const body = await readJson(response);
          return (body.data ?? []).map((item: { msg?: string; time?: string; unix?: number }, index: number) => ({
            id: `${topic}-${item.unix ?? item.time ?? index}-${item.msg ?? ""}`,
            topic,
            message: item.msg ?? "",
            time: item.time ?? new Date().toLocaleString("zh-CN", { hour12: false }),
            unix: Number(item.unix ?? 0),
          })) as ReceivedMessage[];
        }),
      );

      const fresh = results.flat().filter((item) => {
        if (knownMessages.current.has(item.id)) return false;
        knownMessages.current.add(item.id);
        return true;
      });
      if (fresh.length) {
        setMessages((current) => [...fresh, ...current].sort((a, b) => b.unix - a.unix).slice(0, 120));
      }
      setLastSync(new Date().toLocaleTimeString("zh-CN", { hour12: false }));
    } catch (error) {
      notify(error instanceof Error ? error.message : "订阅同步失败", "error");
      setIsListening(false);
    } finally {
      setIsPolling(false);
    }
  }, [config.privateKey, config.subscribeTopics, notify]);

  useEffect(() => {
    if (!isListening) return;
    void pollMessages();
    const timer = setInterval(() => void pollMessages(), Math.max(2, config.pollSeconds) * 1000);
    return () => clearInterval(timer);
  }, [config.pollSeconds, isListening, pollMessages]);

  const toggleListening = () => {
    if (isListening) {
      setIsListening(false);
      notify("已暂停接收消息");
      return;
    }
    if (!config.privateKey.trim()) {
      notify("请先填写巴法云私钥", "error");
      setSettingsOpen(true);
      return;
    }
    if (getTopicList(config.subscribeTopics).length === 0) {
      notify("请至少填写一个订阅主题", "error");
      setSettingsOpen(true);
      return;
    }
    knownMessages.current.clear();
    setIsListening(true);
    notify("已开始接收主题消息");
  };

  const saveButton = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editingButton) return;
    const isToggle = editingButton.kind === "toggle";
    if (!editingButton.name.trim()) return notify("按钮名称不能为空", "error");
    if (isToggle && (!editingButton.onMessage.trim() || !editingButton.offMessage.trim())) {
      return notify("开关按钮需要填写开启和关闭消息", "error");
    }
    if (!isToggle && !editingButton.message.trim()) return notify("发送消息不能为空", "error");

    const saved = { ...editingButton, id: editingButton.id || makeId(), name: editingButton.name.trim() };
    setButtons((current) => {
      const exists = current.some((item) => item.id === saved.id);
      return exists ? current.map((item) => (item.id === saved.id ? saved : item)) : [...current, saved];
    });
    setToggleStates((current) => ({ ...current, [saved.id]: false }));
    setEditingButton(null);
    notify(editingButton.id ? "按钮设置已更新" : "新按钮已添加");
  };

  const removeButton = (button: ControlButton) => {
    if (!window.confirm(`确定删除“${button.name}”吗？`)) return;
    setButtons((current) => current.filter((item) => item.id !== button.id));
    setEditingButton(null);
    notify("按钮已删除");
  };

  const saveChain = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editingChain) return;
    if (!editingChain.name.trim()) return notify("动作链名称不能为空", "error");
    if (editingChain.actions.length === 0) return notify("请至少添加一个动作", "error");
    for (const action of editingChain.actions) {
      if (!action.message.trim()) return notify("每个动作都需要填写发送消息", "error");
      if (action.timing === "delay" && (!Number.isFinite(action.delayValue) || action.delayValue <= 0)) {
        return notify("等待时间必须大于 0", "error");
      }
      if (action.timing === "clock" && !/^([01]\d|2[0-3]):[0-5]\d$/.test(action.clockTime)) {
        return notify("请选择有效的执行时刻", "error");
      }
    }

    const saved = {
      ...editingChain,
      id: editingChain.id || makeId(),
      name: editingChain.name.trim(),
      actions: editingChain.actions.map((action) => ({ ...action, message: action.message.trim() })),
    };
    setChains((current) => {
      const exists = current.some((item) => item.id === saved.id);
      return exists ? current.map((item) => (item.id === saved.id ? saved : item)) : [...current, saved];
    });
    setChainRuns((current) => {
      const next = { ...current };
      delete next[saved.id];
      return next;
    });
    setEditingChain(null);
    notify(editingChain.id ? "动作链已更新" : "动作链已创建");
  };

  const updateEditingAction = (actionId: string, patch: Partial<ChainAction>) => {
    if (!editingChain) return;
    setEditingChain({
      ...editingChain,
      actions: editingChain.actions.map((action) => (action.id === actionId ? { ...action, ...patch } : action)),
    });
  };

  const removeEditingAction = (actionId: string) => {
    if (!editingChain) return;
    setEditingChain({ ...editingChain, actions: editingChain.actions.filter((action) => action.id !== actionId) });
  };

  const startChain = (chain: ActionChain) => {
    if (!validateConnection()) return;
    if (chain.actions.length === 0) return notify("这个动作链还没有动作", "error");
    const token = makeId();
    setChainRuns((current) => ({
      ...current,
      [chain.id]: {
        token,
        status: "waiting",
        currentIndex: 0,
        nextAt: actionDueAt(chain.actions[0], Date.now()),
        remainingMs: null,
      },
    }));
    notify(`${chain.name} · 已启动`);
  };

  const pauseOrResumeChain = (chain: ActionChain) => {
    const run = chainRuns[chain.id];
    if (!run || run.status === "sending") return;
    if (run.status === "paused") {
      setChainRuns((current) => ({
        ...current,
        [chain.id]: { ...run, status: "waiting", nextAt: Date.now() + Math.max(0, run.remainingMs ?? 0), remainingMs: null },
      }));
      notify(`${chain.name} · 继续执行`);
      return;
    }
    if (run.status === "waiting") {
      setChainRuns((current) => ({
        ...current,
        [chain.id]: { ...run, status: "paused", remainingMs: Math.max(0, (run.nextAt ?? Date.now()) - Date.now()), nextAt: null },
      }));
      notify(`${chain.name} · 已暂停`);
    }
  };

  const resetChain = (chain: ActionChain, silent = false) => {
    const hadRun = Boolean(chainRuns[chain.id]);
    setChainRuns((current) => {
      const next = { ...current };
      delete next[chain.id];
      return next;
    });
    executingChains.current.delete(chain.id);
    if (hadRun && !silent) notify(`${chain.name} · 已停止`);
  };

  const editChain = (chain: ActionChain) => {
    resetChain(chain, true);
    setEditingChain({ ...chain, actions: chain.actions.map((action) => ({ ...action })) });
  };

  const removeChain = (chain: ActionChain) => {
    if (!window.confirm(`确定删除动作链“${chain.name}”吗？`)) return;
    resetChain(chain, true);
    setChains((current) => current.filter((item) => item.id !== chain.id));
    setEditingChain(null);
    notify("动作链已删除");
  };

  const subscribedCount = useMemo(() => getTopicList(config.subscribeTopics).length, [config.subscribeTopics]);
  const activeChainCount = useMemo(
    () => Object.values(chainRuns).filter((run) => run.status === "waiting" || run.status === "sending").length,
    [chainRuns],
  );

  return (
    <main className="app-shell">
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />

      <header className="topbar">
        <a className="brand" href="#top" aria-label="返回顶部">
          <span className="brand-mark"><i /><i /><i /></span>
          <span>
            <strong>BEAM</strong>
            <small>巴法云控制台</small>
          </span>
        </a>
        <div className="top-actions">
          <div className={`connection-chip ${isListening ? "online" : ""}`}>
            <span className="status-dot" />
            {isListening ? `监听 ${subscribedCount} 个主题` : "等待连接"}
          </div>
          <button className="icon-button" type="button" onClick={() => setSettingsOpen((open) => !open)} aria-label="连接设置">
            <span className="gear">✦</span>
          </button>
        </div>
      </header>

      <section className="hero" id="top">
        <div className="eyebrow"><span /> YOUR DEVICES, ONE PULSE</div>
        <div className="hero-grid">
          <div>
            <h1>设备指令，<br /><em>触手可及。</em></h1>
            <p>把常用的控制指令变成专属按钮。轻触发送，即时掌握下位机回传的每一条状态。</p>
          </div>
          <div className="hero-stats">
            <div><strong>{buttons.length.toString().padStart(2, "0")}</strong><span>控制按钮</span></div>
            <div><strong>{chains.length.toString().padStart(2, "0")}</strong><span>动作链</span></div>
            <div><strong>{messages.length.toString().padStart(2, "0")}</strong><span>本次消息</span></div>
          </div>
        </div>
      </section>

      <section className={`settings-panel ${settingsOpen ? "open" : ""}`} aria-hidden={!settingsOpen}>
        <div className="section-heading compact">
          <div><span className="section-index">01</span><h2>连接设置</h2></div>
          <button type="button" className="text-button" onClick={() => setSettingsOpen(false)}>收起</button>
        </div>
        <div className="settings-grid">
          <label className="field field-key">
            <span>巴法云私钥</span>
            <div className="input-with-action">
              <input
                type={keyVisible ? "text" : "password"}
                value={config.privateKey}
                onChange={(event) => setConfig({ ...config, privateKey: event.target.value })}
                placeholder="粘贴你的 UID / 私钥"
                autoComplete="off"
              />
              <button type="button" onClick={() => setKeyVisible((value) => !value)}>{keyVisible ? "隐藏" : "显示"}</button>
            </div>
          </label>
          <label className="field">
            <span>发布主题</span>
            <input value={config.publishTopic} onChange={(event) => setConfig({ ...config, publishTopic: event.target.value })} placeholder="例如 light002" />
          </label>
          <label className="field">
            <span>订阅主题 <small>多个用逗号分隔</small></span>
            <input value={config.subscribeTopics} onChange={(event) => setConfig({ ...config, subscribeTopics: event.target.value })} placeholder="例如 state002, sensor002" />
          </label>
          <label className="field small-field">
            <span>同步间隔</span>
            <select value={config.pollSeconds} onChange={(event) => setConfig({ ...config, pollSeconds: Number(event.target.value) })}>
              <option value={2}>2 秒</option><option value={3}>3 秒</option><option value={5}>5 秒</option><option value={10}>10 秒</option>
            </select>
          </label>
        </div>
        <label className="remember-row">
          <input type="checkbox" checked={config.rememberKey} onChange={(event) => setConfig({ ...config, rememberKey: event.target.checked })} />
          <span>在这台设备上保存私钥</span>
          <small>信息仅保存在当前浏览器中</small>
        </label>
      </section>

      <section className="controls-section">
        <div className="section-heading">
          <div><span className="section-index">02</span><h2>快捷控制</h2></div>
          <button className="add-button" type="button" onClick={() => setEditingButton({ ...emptyButton })}>
            <span>＋</span> 新建按钮
          </button>
        </div>

        <div className="control-grid">
          {buttons.map((button, index) => {
            const active = toggleStates[button.id] ?? false;
            const currentMessage = button.kind === "toggle" ? (active ? button.offMessage : button.onMessage) : button.message;
            return (
              <article
                key={button.id}
                className={`control-card tone-${button.tone} ${active ? "is-on" : ""} ${pressedId === button.id ? "is-pressed" : ""}`}
              >
                <div className="card-topline">
                  <span className="card-number">{String(index + 1).padStart(2, "0")}</span>
                  <button className="edit-button" type="button" onClick={() => setEditingButton({ ...button })} aria-label={`编辑${button.name}`}>编辑</button>
                </div>
                <button className="control-trigger" type="button" onClick={() => void handleControl(button)} disabled={sendingId !== null}>
                  <span className="control-icon" aria-hidden="true">
                    {button.kind === "toggle" ? <i className="power-symbol" /> : <i className="pulse-symbol"><b /><b /><b /></i>}
                  </span>
                  <span className="control-copy">
                    <strong>{button.name}</strong>
                    <small>
                      {sendingId === button.id ? "正在发送…" : button.kind === "toggle" ? (active ? "已开启 · 点击关闭" : "已关闭 · 点击开启") : `发送 “${currentMessage}”`}
                    </small>
                  </span>
                  {button.kind === "toggle" ? (
                    <span className={`switch ${active ? "on" : ""}`} aria-hidden="true"><i /></span>
                  ) : (
                    <span className="send-arrow" aria-hidden="true">↗</span>
                  )}
                </button>
              </article>
            );
          })}
          <button className="empty-card" type="button" onClick={() => setEditingButton({ ...emptyButton })}>
            <span>＋</span><strong>添加控制</strong><small>普通按钮或开关按钮</small>
          </button>
        </div>
      </section>

      <section className="chains-section">
        <div className="section-heading">
          <div><span className="section-index">03</span><h2>动作链</h2></div>
          <button className="add-button chain-add" type="button" onClick={() => setEditingChain({ id: "", name: "", actions: [createAction()] })}>
            <span>＋</span> 新建动作链
          </button>
        </div>

        <div className="chain-notice">
          <span className="notice-icon">⌁</span>
          <p><strong>顺序执行</strong> · 每个动作会在上一个动作完成后开始计时；指定时刻若已过，将安排到次日。</p>
          <small>{activeChainCount > 0 ? `${activeChainCount} 条动作链正在运行` : "执行期间请保持网页打开"}</small>
        </div>

        {chains.length === 0 ? (
          <button className="chain-empty" type="button" onClick={() => setEditingChain({ id: "", name: "", actions: [createAction()] })}>
            <span className="timeline-preview"><i /><i /><i /></span>
            <strong>创建第一条动作链</strong>
            <small>组合等待时间、指定时刻与发送消息</small>
          </button>
        ) : (
          <div className="chain-grid">
            {chains.map((chain, index) => {
              const run = chainRuns[chain.id];
              const currentAction = run && run.currentIndex < chain.actions.length ? chain.actions[run.currentIndex] : null;
              const isActive = run?.status === "waiting" || run?.status === "sending" || run?.status === "paused";
              const countdown = run?.status === "paused"
                ? countdownLabel(run.remainingMs ?? 0)
                : run?.nextAt
                  ? countdownLabel(run.nextAt - now)
                  : "";
              const progress = run?.status === "completed" ? 100 : Math.round(((run?.currentIndex ?? 0) / Math.max(1, chain.actions.length)) * 100);
              return (
                <article className={`chain-card ${isActive ? "is-running" : ""} status-${run?.status ?? "idle"}`} key={chain.id}>
                  <div className="chain-card-head">
                    <span className="chain-index">CHAIN {String(index + 1).padStart(2, "0")}</span>
                    <button type="button" onClick={() => editChain(chain)}>编辑</button>
                  </div>
                  <div className="chain-title-row">
                    <div><h3>{chain.name}</h3><p>{chain.actions.length} 个动作 · 顺序执行</p></div>
                    <span className={`chain-state ${isActive ? "active" : ""}`}>
                      {run?.status === "waiting" ? "等待中" : run?.status === "sending" ? "发送中" : run?.status === "paused" ? "已暂停" : run?.status === "completed" ? "已完成" : run?.status === "error" ? "执行失败" : "未启动"}
                    </span>
                  </div>

                  <ol className="chain-action-list">
                    {chain.actions.map((action, actionIndex) => (
                      <li className={run && actionIndex === run.currentIndex && isActive ? "current" : run && actionIndex < run.currentIndex ? "done" : ""} key={action.id}>
                        <span className="action-node">{run && actionIndex < run.currentIndex ? "✓" : actionIndex + 1}</span>
                        <span><small>{actionTimingLabel(action)}</small><code>{action.message}</code></span>
                      </li>
                    ))}
                  </ol>

                  <div className="chain-progress"><i style={{ width: `${progress}%` }} /></div>
                  <div className="chain-status-line">
                    {run?.status === "waiting" && currentAction ? <><span>下一动作</span><strong>{countdown} 后发送 “{currentAction.message}”</strong></> : null}
                    {run?.status === "paused" && currentAction ? <><span>剩余时间</span><strong>{countdown} · “{currentAction.message}”</strong></> : null}
                    {run?.status === "sending" && currentAction ? <><span>正在发送</span><strong>“{currentAction.message}”</strong></> : null}
                    {run?.status === "completed" ? <><span>运行结果</span><strong>全部动作执行完成</strong></> : null}
                    {run?.status === "error" ? <><span>运行结果</span><strong>{run.error}</strong></> : null}
                    {!run ? <><span>首个动作</span><strong>{actionTimingLabel(chain.actions[0])}后执行</strong></> : null}
                  </div>
                  <div className="chain-card-actions">
                    {!isActive || run?.status === "completed" || run?.status === "error" ? (
                      <button className="chain-primary" type="button" onClick={() => startChain(chain)}>▶ 启动动作链</button>
                    ) : (
                      <button className="chain-primary" type="button" disabled={run?.status === "sending"} onClick={() => pauseOrResumeChain(chain)}>
                        {run?.status === "paused" ? "▶ 继续" : run?.status === "sending" ? "正在发送…" : "Ⅱ 暂停"}
                      </button>
                    )}
                    {isActive ? <button className="chain-stop" type="button" onClick={() => resetChain(chain)}>停止</button> : null}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="monitor-section">
        <div className="section-heading monitor-heading">
          <div><span className="section-index">04</span><h2>消息订阅</h2></div>
          <div className="monitor-actions">
            <span className="sync-label">{isPolling ? "正在同步…" : `上次同步 ${lastSync}`}</span>
            <button className={`listen-button ${isListening ? "stop" : ""}`} type="button" onClick={toggleListening}>
              <span className="listen-dot" /> {isListening ? "暂停接收" : "开始接收"}
            </button>
          </div>
        </div>

        <div className="message-console">
          <div className="console-header">
            <span>实时消息流</span>
            <div><span className={isListening ? "live" : ""}>{isListening ? "LIVE" : "PAUSED"}</span><button type="button" onClick={() => { setMessages([]); knownMessages.current.clear(); }}>清空</button></div>
          </div>
          <div className="message-list" aria-live="polite">
            {messages.length === 0 ? (
              <div className="empty-messages">
                <span className="radar"><i /><i /></span>
                <strong>{isListening ? "正在等待下位机消息" : "订阅尚未启动"}</strong>
                <p>{isListening ? "新消息到达后会自动出现在这里" : "配置主题后，点击“开始接收”"}</p>
              </div>
            ) : messages.map((item) => (
              <div className="message-row" key={item.id}>
                <span className="message-time">{item.time}</span>
                <span className="message-topic">{item.topic}</span>
                <code>{item.message}</code>
              </div>
            ))}
          </div>
        </div>
      </section>

      <footer>
        <span>BEAM / BEMFA REMOTE</span>
        <p>私钥、按钮与动作链配置仅保存在你的浏览器中</p>
      </footer>

      {editingButton && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) setEditingButton(null); }}>
          <form className="button-modal" onSubmit={saveButton}>
            <div className="modal-heading">
              <div><span>{editingButton.id ? "EDIT CONTROL" : "NEW CONTROL"}</span><h2>{editingButton.id ? "编辑按钮" : "创建控制按钮"}</h2></div>
              <button type="button" onClick={() => setEditingButton(null)} aria-label="关闭">×</button>
            </div>

            <label className="field">
              <span>按钮名称</span>
              <input autoFocus value={editingButton.name} onChange={(event) => setEditingButton({ ...editingButton, name: event.target.value })} placeholder="例如：客厅主灯" />
            </label>

            <fieldset className="kind-picker">
              <legend>按钮类型</legend>
              <label className={editingButton.kind === "pulse" ? "selected" : ""}>
                <input type="radio" name="kind" value="pulse" checked={editingButton.kind === "pulse"} onChange={() => setEditingButton({ ...editingButton, kind: "pulse" })} />
                <span className="mini-icon">↗</span><strong>普通按钮</strong><small>每次点击发送同一条消息</small>
              </label>
              <label className={editingButton.kind === "toggle" ? "selected" : ""}>
                <input type="radio" name="kind" value="toggle" checked={editingButton.kind === "toggle"} onChange={() => setEditingButton({ ...editingButton, kind: "toggle" })} />
                <span className="mini-icon">◐</span><strong>开关按钮</strong><small>在开启与关闭间切换</small>
              </label>
            </fieldset>

            {editingButton.kind === "pulse" ? (
              <label className="field">
                <span>按下后发送的消息</span>
                <input value={editingButton.message} onChange={(event) => setEditingButton({ ...editingButton, message: event.target.value })} placeholder="例如：breath" />
              </label>
            ) : (
              <div className="dual-fields">
                <label className="field"><span>开启时发送</span><input value={editingButton.onMessage} onChange={(event) => setEditingButton({ ...editingButton, onMessage: event.target.value })} placeholder="例如：on" /></label>
                <label className="field"><span>关闭时发送</span><input value={editingButton.offMessage} onChange={(event) => setEditingButton({ ...editingButton, offMessage: event.target.value })} placeholder="例如：off" /></label>
              </div>
            )}

            <fieldset className="tone-picker">
              <legend>按钮色彩</legend>
              {(["cobalt", "coral", "mint", "violet"] as const).map((tone) => (
                <label key={tone} className={`tone-dot ${tone} ${editingButton.tone === tone ? "selected" : ""}`}>
                  <input type="radio" name="tone" value={tone} checked={editingButton.tone === tone} onChange={() => setEditingButton({ ...editingButton, tone })} />
                  <span />
                </label>
              ))}
            </fieldset>

            <div className="modal-actions">
              {editingButton.id ? <button className="delete-button" type="button" onClick={() => removeButton(editingButton)}>删除按钮</button> : <span />}
              <div><button className="cancel-button" type="button" onClick={() => setEditingButton(null)}>取消</button><button className="save-button" type="submit">保存按钮</button></div>
            </div>
          </form>
        </div>
      )}

      {editingChain && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) setEditingChain(null); }}>
          <form className="button-modal chain-modal" onSubmit={saveChain}>
            <div className="modal-heading">
              <div><span>{editingChain.id ? "EDIT SEQUENCE" : "NEW SEQUENCE"}</span><h2>{editingChain.id ? "编辑动作链" : "创建动作链"}</h2></div>
              <button type="button" onClick={() => setEditingChain(null)} aria-label="关闭">×</button>
            </div>

            <label className="field">
              <span>动作链名称</span>
              <input autoFocus value={editingChain.name} onChange={(event) => setEditingChain({ ...editingChain, name: event.target.value })} placeholder="例如：早晨唤醒流程" />
            </label>

            <div className="chain-editor-heading">
              <div><strong>动作列表</strong><small>按照从上到下的顺序执行</small></div>
              <span>{editingChain.actions.length} ACTIONS</span>
            </div>

            <div className="chain-editor-list">
              {editingChain.actions.map((action, index) => (
                <div className="action-editor" key={action.id}>
                  <div className="action-editor-top">
                    <span><i>{index + 1}</i> 动作 {String(index + 1).padStart(2, "0")}</span>
                    <button type="button" disabled={editingChain.actions.length === 1} onClick={() => removeEditingAction(action.id)}>移除</button>
                  </div>
                  <div className="timing-tabs">
                    <label className={action.timing === "delay" ? "selected" : ""}>
                      <input type="radio" name={`timing-${action.id}`} checked={action.timing === "delay"} onChange={() => updateEditingAction(action.id, { timing: "delay" })} />
                      <span>◷</span> 等待一段时间
                    </label>
                    <label className={action.timing === "clock" ? "selected" : ""}>
                      <input type="radio" name={`timing-${action.id}`} checked={action.timing === "clock"} onChange={() => updateEditingAction(action.id, { timing: "clock" })} />
                      <span>◉</span> 到指定时刻
                    </label>
                  </div>
                  <div className="action-editor-fields">
                    {action.timing === "delay" ? (
                      <label className="field timing-field">
                        <span>等待时长</span>
                        <div>
                          <input type="number" min="1" step="1" value={action.delayValue} onChange={(event) => updateEditingAction(action.id, { delayValue: Number(event.target.value) })} />
                          <select value={action.delayUnit} onChange={(event) => updateEditingAction(action.id, { delayUnit: event.target.value as DelayUnit })}>
                            <option value="seconds">秒</option><option value="minutes">分钟</option><option value="hours">小时</option>
                          </select>
                        </div>
                      </label>
                    ) : (
                      <label className="field timing-field">
                        <span>执行时刻</span>
                        <input type="time" value={action.clockTime} onChange={(event) => updateEditingAction(action.id, { clockTime: event.target.value })} />
                      </label>
                    )}
                    <label className="field message-field">
                      <span>发送消息</span>
                      <input value={action.message} onChange={(event) => updateEditingAction(action.id, { message: event.target.value })} placeholder="例如：on" />
                    </label>
                  </div>
                </div>
              ))}
            </div>

            <button className="append-action" type="button" onClick={() => setEditingChain({ ...editingChain, actions: [...editingChain.actions, createAction()] })}>
              <span>＋</span><strong>添加下一个动作</strong><small>可继续设置等待时间或指定时刻</small>
            </button>

            <div className="chain-editor-note"><span>i</span>动作链由当前网页执行，关闭网页或设备休眠会暂停定时任务。</div>

            <div className="modal-actions">
              {editingChain.id ? <button className="delete-button" type="button" onClick={() => removeChain(editingChain)}>删除动作链</button> : <span />}
              <div><button className="cancel-button" type="button" onClick={() => setEditingChain(null)}>取消</button><button className="save-button" type="submit">保存动作链</button></div>
            </div>
          </form>
        </div>
      )}

      {toast && <div className={`toast ${toast.type}`}><span>{toast.type === "success" ? "✓" : "!"}</span>{toast.text}</div>}
    </main>
  );
}
