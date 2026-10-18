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
type SensorMetric = "temperature" | "humidity" | "smoke" | "smokeAlarm" | "light" | "lightTriggered" | "distance";
type ConditionOperator = "<" | "<=" | ">" | ">=" | "==" | "!=";

type ChainCondition = {
  id: string;
  metric: SensorMetric;
  operator: ConditionOperator;
  value: number;
};

type ChainAction = {
  id: string;
  timing: ActionTiming;
  delayValue: number;
  delayUnit: DelayUnit;
  clockTime: string;
  message: string;
  condition: ChainCondition | null;
};

type ActionChain = {
  id: string;
  name: string;
  source: "default" | "user";
  enabled: boolean;
  cooldownSeconds: number;
  scheduleTime: string | null;
  conditions: ChainCondition[];
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

type Telemetry = {
  type: "telemetry";
  version: number;
  seq: number;
  uptime: number;
  sensors: {
    temperature: number | null;
    humidity: number | null;
    smoke: number;
    smokeAlarm: boolean;
    light: number;
    lightPercent: number;
    lightTriggered: boolean;
    distance: number | null;
  };
  enabled: { dht: boolean; mq2: boolean; light: boolean; distance: boolean };
  outputs: { led1: "off" | "on" | "blink"; led2: "off" | "on" | "blink"; buzzer: "off" | "on" | "blink" };
  oled: { page: number; auto: boolean };
  keyboardConnected: boolean;
  online: boolean;
};

type Toast = { text: string; type: "success" | "error" } | null;

type DeviceCommand = {
  group: "输出控制" | "传感器控制" | "OLED 显示" | "蓝牙键盘" | "系统指令" | "兼容指令";
  command: string;
  description: string;
};

const API_BASE = "https://apis.bemfa.com/va";
const TOPIC_API = "https://apis.bemfa.com/vb/api/v2/allTopic";
const CONFIG_KEY = "bemfa-console-config-v1";
const BUTTONS_KEY = "bemfa-console-buttons-v1";
const CHAINS_KEY = "bemfa-console-automation-v2";

const deviceCommands: DeviceCommand[] = [
  { group: "输出控制", command: "led1.on", description: "打开 LED 1" },
  { group: "输出控制", command: "led1.off", description: "关闭 LED 1" },
  { group: "输出控制", command: "led1.blink:500", description: "LED 1 每 500 ms 闪烁" },
  { group: "输出控制", command: "led2.on", description: "打开 LED 2" },
  { group: "输出控制", command: "led2.off", description: "关闭 LED 2" },
  { group: "输出控制", command: "led2.blink:500", description: "LED 2 每 500 ms 闪烁" },
  { group: "输出控制", command: "buzzer.on", description: "蜂鸣器持续鸣响" },
  { group: "输出控制", command: "buzzer.off", description: "关闭蜂鸣器" },
  { group: "输出控制", command: "buzzer.blink:500", description: "蜂鸣器每 500 ms 间歇鸣响" },
  { group: "输出控制", command: "all.off", description: "关闭 LED 1、LED 2 和蜂鸣器" },
  { group: "传感器控制", command: "sensor.dht.on", description: "启用 DHT11 采集" },
  { group: "传感器控制", command: "sensor.dht.off", description: "停用 DHT11 采集" },
  { group: "传感器控制", command: "sensor.mq2.on", description: "启用 MQ-2 采集" },
  { group: "传感器控制", command: "sensor.mq2.off", description: "停用 MQ-2 采集" },
  { group: "传感器控制", command: "sensor.light.on", description: "启用光敏传感器采集" },
  { group: "传感器控制", command: "sensor.light.off", description: "停用光敏传感器采集" },
  { group: "传感器控制", command: "sensor.distance.on", description: "启用超声波距离采集" },
  { group: "传感器控制", command: "sensor.distance.off", description: "停用超声波距离采集" },
  { group: "OLED 显示", command: "oled.sensors", description: "切换到实时传感器页面" },
  { group: "OLED 显示", command: "oled.weather", description: "切换到南京当前天气页面" },
  { group: "OLED 显示", command: "oled.forecast", description: "切换到未来 3 天天气预报" },
  { group: "OLED 显示", command: "oled.clock", description: "切换到日期时间页面" },
  { group: "OLED 显示", command: "oled.calendar", description: "切换到公历 / 农历页面" },
  { group: "OLED 显示", command: "oled.holiday", description: "切换到最近节日页面" },
  { group: "OLED 显示", command: "oled.prev", description: "切换到上一页" },
  { group: "OLED 显示", command: "oled.next", description: "切换到下一页" },
  { group: "OLED 显示", command: "oled.auto", description: "每 8 秒自动轮播页面" },
  { group: "OLED 显示", command: "oled.manual", description: "停止自动轮播，保留当前页" },
  { group: "蓝牙键盘", command: "keyboard.1", description: "在已连接的电脑上输入数字 1" },
  { group: "蓝牙键盘", command: "keyboard.2", description: "在已连接的电脑上输入数字 2" },
  { group: "蓝牙键盘", command: "keyboard.3", description: "在已连接的电脑上输入数字 3" },
  { group: "蓝牙键盘", command: "keyboard.4", description: "在已连接的电脑上输入数字 4" },
  { group: "蓝牙键盘", command: "keyboard.5", description: "在已连接的电脑上输入数字 5" },
  { group: "蓝牙键盘", command: "keyboard.6", description: "在已连接的电脑上输入数字 6" },
  { group: "蓝牙键盘", command: "keyboard.7", description: "在已连接的电脑上输入数字 7" },
  { group: "蓝牙键盘", command: "keyboard.8", description: "在已连接的电脑上输入数字 8" },
  { group: "蓝牙键盘", command: "keyboard.9", description: "在已连接的电脑上输入数字 9" },
  { group: "系统指令", command: "get_state", description: "要求设备立即回传一次状态" },
  { group: "兼容指令", command: "get", description: "兼容旧版：立即回传一次状态" },
  { group: "兼容指令", command: "on", description: "兼容旧版：打开 LED 1" },
  { group: "兼容指令", command: "off", description: "兼容旧版：关闭 LED 1" },
  { group: "兼容指令", command: "bar", description: "兼容旧版：打开蜂鸣器" },
  { group: "兼容指令", command: "baroff", description: "兼容旧版：关闭蜂鸣器" },
];

const oledPages = [
  { label: "传感器", command: "oled.sensors", page: 0 },
  { label: "当前天气", command: "oled.weather", page: 1 },
  { label: "3 日预报", command: "oled.forecast", page: 2 },
  { label: "日期时间", command: "oled.clock", page: 3 },
  { label: "阴阳历", command: "oled.calendar", page: 4 },
  { label: "最近节日", command: "oled.holiday", page: 5 },
] as const;

const defaultConfig: BemfaConfig = {
  privateKey: "",
  publishTopic: "3UU82P0su002",
  subscribeTopics: "3UU82P0su002",
  pollSeconds: 3,
  rememberKey: true,
};

const defaultButtons: ControlButton[] = [
  {
    id: "led1-switch",
    name: "LED 1",
    kind: "toggle",
    message: "",
    onMessage: "led1.on",
    offMessage: "led1.off",
    tone: "cobalt",
  },
  {
    id: "led2-switch",
    name: "LED 2",
    kind: "toggle",
    message: "",
    onMessage: "led2.on",
    offMessage: "led2.off",
    tone: "mint",
  },
  {
    id: "buzzer-switch",
    name: "蜂鸣器",
    kind: "toggle",
    message: "",
    onMessage: "buzzer.on",
    offMessage: "buzzer.off",
    tone: "coral",
  },
  {
    id: "all-off",
    name: "全部关闭",
    kind: "pulse",
    message: "all.off",
    onMessage: "",
    offMessage: "",
    tone: "violet",
  },
  {
    id: "refresh-state",
    name: "立即同步",
    kind: "pulse",
    message: "get_state",
    onMessage: "",
    offMessage: "",
    tone: "cobalt",
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
    condition: null,
  };
}

function createCondition(): ChainCondition {
  return { id: makeId(), metric: "distance", operator: "<", value: 10 };
}

const metricLabels: Record<SensorMetric, string> = {
  temperature: "温度 (°C)",
  humidity: "湿度 (%)",
  smoke: "烟雾模拟值",
  smokeAlarm: "烟雾报警",
  light: "光敏模拟值",
  lightTriggered: "检测到黑暗环境",
  distance: "超声距离 (cm)",
};

const defaultChains: ActionChain[] = [
  {
    id: "default-dark-led1",
    name: "黑暗环境点亮 LED1",
    source: "default",
    enabled: true,
    cooldownSeconds: 30,
    scheduleTime: null,
    conditions: [{ id: "default-dark-condition", metric: "lightTriggered", operator: "==", value: 1 }],
    actions: [{ ...createAction(), id: "default-dark-led1-action", delayValue: 0, message: "led1.on" }],
  },
];

function createChain(): ActionChain {
  return {
    id: "",
    name: "",
    source: "user",
    enabled: true,
    cooldownSeconds: 30,
    scheduleTime: null,
    conditions: [createCondition()],
    actions: [{ ...createAction(), delayValue: 0 }],
  };
}

function localClockMinute(timestamp: number) {
  const date = new Date(timestamp);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function localDateKey(timestamp: number) {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
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
  if (action.delayValue === 0) return "立即";
  const unit = action.delayUnit === "hours" ? "小时" : action.delayUnit === "minutes" ? "分钟" : "秒";
  return `等待 ${action.delayValue} ${unit}`;
}

function conditionLabel(condition: ChainCondition) {
  const value = (condition.metric === "smokeAlarm" || condition.metric === "lightTriggered")
    ? (condition.value === 1 ? "是" : "否")
    : condition.value;
  return `${metricLabels[condition.metric]} ${condition.operator} ${value}`;
}

function conditionMatches(condition: ChainCondition, telemetry: Telemetry) {
  const raw = telemetry.sensors[condition.metric];
  if (raw === null || raw === undefined) return false;
  const current = typeof raw === "boolean" ? (raw ? 1 : 0) : raw;
  switch (condition.operator) {
    case "<": return current < condition.value;
    case "<=": return current <= condition.value;
    case ">": return current > condition.value;
    case ">=": return current >= condition.value;
    case "==": return current === condition.value;
    case "!=": return current !== condition.value;
  }
}

function parseTelemetry(message: string): Telemetry | null {
  try {
    const value = JSON.parse(message) as Partial<Telemetry> & { t?: string; q?: number; u?: number; a?: unknown[]; e?: number; o?: number[]; p?: number; x?: number; b?: number };
    if (value.type === "telemetry" && value.sensors && value.enabled && value.outputs) {
      return {
        ...(value as Telemetry),
        oled: value.oled ?? { page: 0, auto: false },
        keyboardConnected: value.keyboardConnected ?? false,
      };
    }
    if (value.t !== "s" || !Array.isArray(value.a) || value.a.length < 8 || !Array.isArray(value.o) || value.o.length < 3) return null;
    const sensor = value.a;
    const enabled = Number(value.e ?? 0);
    const outputMode = (mode: unknown): "off" | "on" | "blink" => Number(mode) === 2 ? "blink" : Number(mode) === 1 ? "on" : "off";
    const nullableNumber = (raw: unknown) => raw === null || raw === undefined ? null : Number(raw);
    return {
      type: "telemetry",
      version: 2,
      seq: Number(value.q ?? 0),
      uptime: Number(value.u ?? 0),
      sensors: {
        temperature: nullableNumber(sensor[0]),
        humidity: nullableNumber(sensor[1]),
        smoke: Number(sensor[2] ?? 0),
        smokeAlarm: Boolean(sensor[3]),
        light: Number(sensor[4] ?? 0),
        lightPercent: Number(sensor[5] ?? 0),
        lightTriggered: Boolean(sensor[6]),
        distance: nullableNumber(sensor[7]),
      },
      enabled: { dht: Boolean(enabled & 1), mq2: Boolean(enabled & 2), light: Boolean(enabled & 4), distance: Boolean(enabled & 8) },
      outputs: { led1: outputMode(value.o[0]), led2: outputMode(value.o[1]), buzzer: outputMode(value.o[2]) },
      oled: { page: Number(value.p ?? 0), auto: Boolean(value.x) },
      keyboardConnected: Boolean(value.b),
      online: true,
    };
  } catch {
    return null;
  }
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
  const [chains, setChains] = useState<ActionChain[]>(defaultChains);
  const [chainRuns, setChainRuns] = useState<Record<string, ChainRun>>({});
  const [toggleStates, setToggleStates] = useState<Record<string, boolean>>({});
  const [editingButton, setEditingButton] = useState<ControlButton | null>(null);
  const [editingChain, setEditingChain] = useState<ActionChain | null>(null);
  const [commandsOpen, setCommandsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [keyVisible, setKeyVisible] = useState(false);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [pressedId, setPressedId] = useState<string | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [isPolling, setIsPolling] = useState(false);
  const [messages, setMessages] = useState<ReceivedMessage[]>([]);
  const [toast, setToast] = useState<Toast>(null);
  const [lastSync, setLastSync] = useState<string>("尚未同步");
  const [telemetry, setTelemetry] = useState<Telemetry | null>(null);
  const [telemetryReceivedAt, setTelemetryReceivedAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const knownMessages = useRef(new Set<string>());
  const lastTelemetrySequence = useRef<number | null>(null);
  const telemetryRef = useRef<Telemetry | null>(null);
  const executingChains = useRef(new Set<string>());
  const ruleLatch = useRef<Record<string, boolean>>({});
  const lastRuleRun = useRef<Record<string, number>>({});
  const lastScheduleRunDay = useRef<Record<string, string>>({});
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    try {
      const savedConfig = localStorage.getItem(CONFIG_KEY);
      const savedButtons = localStorage.getItem(BUTTONS_KEY);
      const savedChains = localStorage.getItem(CHAINS_KEY);
      if (savedConfig) {
        const parsedConfig = { ...defaultConfig, ...JSON.parse(savedConfig) } as BemfaConfig;
        setConfig(parsedConfig);
        if (parsedConfig.privateKey && getTopicList(parsedConfig.subscribeTopics).length > 0) setIsListening(true);
      }
      if (savedButtons) setButtons(JSON.parse(savedButtons));
      if (savedChains) {
        const userChains = (JSON.parse(savedChains) as Partial<ActionChain>[]).map((chain) => ({
          ...createChain(),
          ...chain,
          source: "user" as const,
          scheduleTime: chain.scheduleTime ?? null,
          conditions: chain.conditions?.length ? chain.conditions : [createCondition()],
          actions: chain.actions?.length
            ? chain.actions.map((action) => ({ ...createAction(), ...action, condition: action.condition ?? null }))
            : [{ ...createAction(), delayValue: 0 }],
        }));
        setChains([...defaultChains, ...userChains]);
      }
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
    localStorage.setItem(CHAINS_KEY, JSON.stringify(chains.filter((chain) => chain.source === "user")));
  }, [chains]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    telemetryRef.current = telemetry;
  }, [telemetry]);

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

        const advance = () => {
          const nextIndex = run.currentIndex + 1;
          setChainRuns((current) => {
            const latest = current[chainId];
            if (latest?.token !== run.token) return current;
            if (nextIndex >= chain.actions.length) {
              return { ...current, [chainId]: { ...latest, status: "completed", currentIndex: nextIndex, nextAt: null, remainingMs: null } };
            }
            return {
              ...current,
              [chainId]: {
                ...latest,
                status: "waiting",
                currentIndex: nextIndex,
                nextAt: actionDueAt(chain.actions[nextIndex], Date.now()),
                remainingMs: null,
              },
            };
          });
          if (nextIndex >= chain.actions.length) notify(`${chain.name} · 动作链执行完成`);
        };

        if (action.condition) {
          const liveTelemetry = telemetryRef.current;
          if (!liveTelemetry || !conditionMatches(action.condition, liveTelemetry)) {
            advance();
            return;
          }
        }

        executingChains.current.add(chainId);
        setChainRuns((current) => {
          if (current[chainId]?.token !== run.token) return current;
          return { ...current, [chainId]: { ...run, status: "sending", nextAt: null } };
        });

        void publish(action.message)
          .then(() => {
            advance();
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

  const sendCatalogCommand = async (command: string) => {
    if (!validateConnection() || sendingId) return;
    const commandId = `command:${command}`;
    setSendingId(commandId);
    try {
      await publish(command);
      notify(`已发送“${command}”`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "消息发送失败", "error");
    } finally {
      setSendingId(null);
    }
  };

  const sendOledCommand = async (command: string, label: string, page?: number) => {
    if (!validateConnection() || sendingId) return;
    const commandId = `oled:${command}`;
    setSendingId(commandId);
    try {
      await publish(command);
      setTelemetry((current) => {
        if (!current) return current;
        let nextPage = current.oled.page;
        if (typeof page === "number") nextPage = page;
        if (command === "oled.next") nextPage = (nextPage + 1) % oledPages.length;
        if (command === "oled.prev") nextPage = (nextPage + oledPages.length - 1) % oledPages.length;
        return {
          ...current,
          oled: {
            page: nextPage,
            auto: command === "oled.auto" ? true : command === "oled.manual" ? false : command.startsWith("oled.") ? false : current.oled.auto,
          },
        };
      });
      notify(`OLED · 已切换${label}`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "OLED 控制失败", "error");
    } finally {
      setSendingId(null);
    }
  };

  const sendKeyboardDigit = async (digit: number) => {
    if (!validateConnection() || sendingId) return;
    if (!telemetry?.keyboardConnected) {
      notify("请先在电脑蓝牙设置中连接 ESP32 Web Keypad", "error");
      return;
    }
    const commandId = `keyboard:${digit}`;
    setSendingId(commandId);
    try {
      await publish(`keyboard.${digit}`);
      notify(`蓝牙键盘 · 已输入 ${digit}`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "蓝牙键盘命令发送失败", "error");
    } finally {
      setSendingId(null);
    }
  };

  const pollMessages = useCallback(async () => {
    const topics = getTopicList(config.subscribeTopics);
    if (!config.privateKey.trim() || topics.length === 0) return;
    setIsPolling(true);
    try {
      const [results, topicOverview] = await Promise.all([
        Promise.all(
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
        ),
        fetch(`${TOPIC_API}?${new URLSearchParams({ openID: config.privateKey.trim(), type: "1" }).toString()}`, { cache: "no-store" })
          .then((response) => response.json())
          .then((body) => body?.code === 0 ? (body?.data?.data ?? body?.data ?? []) : [])
          .catch(() => []),
      ]);

      const topicSet = new Set(topics);
      const overviewMessages = (Array.isArray(topicOverview) ? topicOverview : [])
        .filter((item: { topic?: string; msg?: string }) => item.topic && topicSet.has(item.topic) && typeof item.msg === "string" && item.msg.length > 0)
        .map((item: { topic: string; msg: string; time?: string; unix?: number }) => ({
          id: `${item.topic}-${item.unix ?? item.time ?? "latest"}-${item.msg}`,
          topic: item.topic,
          message: item.msg,
          time: item.time ?? new Date().toLocaleString("zh-CN", { hour12: false }),
          unix: Number(item.unix ?? 0),
        })) as ReceivedMessage[];
      const allMessages = [...results.flat(), ...overviewMessages];
      const latestTelemetry = allMessages
        .map((item) => ({ item, value: parseTelemetry(item.message) }))
        .filter((entry): entry is { item: ReceivedMessage; value: Telemetry } => entry.value !== null)
        .sort((a, b) => b.item.unix - a.item.unix)[0];
      if (latestTelemetry) {
        if (latestTelemetry.value.seq !== lastTelemetrySequence.current) {
          lastTelemetrySequence.current = latestTelemetry.value.seq;
          setTelemetry(latestTelemetry.value);
          setTelemetryReceivedAt(Date.now());
        }
      }

      const fresh = allMessages.filter((item) => {
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
    if (!telemetry) return;
    setToggleStates((current) => ({
      ...current,
      "led1-switch": telemetry.outputs.led1 !== "off",
      "led2-switch": telemetry.outputs.led2 !== "off",
      "buzzer-switch": telemetry.outputs.buzzer !== "off",
    }));
  }, [telemetry]);

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
    if (editingChain.conditions.length === 0) return notify("请至少添加一个触发条件", "error");
    if (editingChain.actions.length === 0) return notify("请至少添加一个动作", "error");
    if (editingChain.scheduleTime !== null && !/^([01]\d|2[0-3]):[0-5]\d$/.test(editingChain.scheduleTime)) {
      return notify("请选择有效的每日触发时刻", "error");
    }
    for (const action of editingChain.actions) {
      if (!action.message.trim()) return notify("每个动作都需要填写发送消息", "error");
      if (action.timing === "delay" && (!Number.isFinite(action.delayValue) || action.delayValue < 0)) {
        return notify("等待时间不能小于 0", "error");
      }
      if (action.timing === "clock" && !/^([01]\d|2[0-3]):[0-5]\d$/.test(action.clockTime)) {
        return notify("请选择有效的执行时刻", "error");
      }
    }

    const saved = {
      ...editingChain,
      id: editingChain.id || makeId(),
      name: editingChain.name.trim(),
      source: "user" as const,
      cooldownSeconds: Math.max(1, editingChain.cooldownSeconds || 1),
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

  const updateEditingCondition = (conditionId: string, patch: Partial<ChainCondition>) => {
    if (!editingChain) return;
    setEditingChain({
      ...editingChain,
      conditions: editingChain.conditions.map((condition) => condition.id === conditionId ? { ...condition, ...patch } : condition),
    });
  };

  const removeEditingCondition = (conditionId: string) => {
    if (!editingChain || editingChain.conditions.length === 1) return;
    setEditingChain({ ...editingChain, conditions: editingChain.conditions.filter((condition) => condition.id !== conditionId) });
  };

  const startChain = useCallback((chain: ActionChain, automatic = false) => {
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
    notify(`${chain.name} · ${automatic ? "条件满足，已触发" : "已启动"}`);
  }, [notify, validateConnection]);

  useEffect(() => {
    if (!telemetry || !isListening) return;
    const currentTime = Date.now();
    const clockMinute = localClockMinute(currentTime);
    const dateKey = localDateKey(currentTime);
    chains.forEach((chain) => {
      if (!chain.enabled || chain.conditions.length === 0) return;
      const scheduleMatches = chain.scheduleTime === null ||
        (chain.scheduleTime === clockMinute && lastScheduleRunDay.current[chain.id] !== dateKey);
      const matches = scheduleMatches && chain.conditions.every((condition) => conditionMatches(condition, telemetry));
      const wasMatching = ruleLatch.current[chain.id] ?? false;
      ruleLatch.current[chain.id] = matches;
      const active = ["waiting", "sending", "paused"].includes(chainRuns[chain.id]?.status ?? "");
      const cooledDown = currentTime - (lastRuleRun.current[chain.id] ?? 0) >= chain.cooldownSeconds * 1000;
      if (matches && !wasMatching && !active && cooledDown) {
        lastRuleRun.current[chain.id] = currentTime;
        if (chain.scheduleTime !== null) lastScheduleRunDay.current[chain.id] = dateKey;
        startChain(chain, true);
      }
    });
  }, [chainRuns, chains, isListening, startChain, telemetry]);

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
    if (chain.source === "default") return;
    resetChain(chain, true);
    setEditingChain({
      ...chain,
      conditions: chain.conditions.map((condition) => ({ ...condition })),
      actions: chain.actions.map((action) => ({
        ...action,
        condition: action.condition ? { ...action.condition } : null,
      })),
    });
  };

  const duplicateChain = (chain: ActionChain) => {
    setEditingChain({
      ...chain,
      id: "",
      name: `${chain.name}（副本）`,
      source: "user",
      conditions: chain.conditions.map((condition) => ({ ...condition, id: makeId() })),
      actions: chain.actions.map((action) => ({
        ...action,
        id: makeId(),
        condition: action.condition ? { ...action.condition, id: makeId() } : null,
      })),
    });
  };

  const toggleChainEnabled = (chain: ActionChain) => {
    setChains((current) => current.map((item) => item.id === chain.id ? { ...item, enabled: !item.enabled } : item));
    ruleLatch.current[chain.id] = false;
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
  const deviceOnline = Boolean(telemetry?.online && telemetryReceivedAt && now - telemetryReceivedAt < Math.max(8000, config.pollSeconds * 3000));
  const userChainCount = chains.filter((chain) => chain.source === "user").length;

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
            <div><strong>{userChainCount.toString().padStart(2, "0")}</strong><span>用户动作链</span></div>
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

      <section className="sensors-section">
        <div className="section-heading sensor-heading">
          <div><span className="section-index">02</span><h2>实时传感器</h2></div>
          <div className={`device-health ${deviceOnline ? "online" : ""}`}>
            <span className="status-dot" />
            {deviceOnline ? `设备在线 · 运行 ${Math.floor((telemetry?.uptime ?? 0) / 60)} 分钟` : "等待设备遥测"}
          </div>
        </div>
        <div className="sensor-grid">
          <article className={`sensor-card ${telemetry?.enabled.dht ? "enabled" : "disabled"}`}>
            <div className="sensor-card-head"><span>DHT11</span><span className="sensor-readonly">只读</span></div>
            <div className="sensor-values"><strong>{telemetry?.sensors.temperature ?? "--"}<small> °C</small></strong><strong>{telemetry?.sensors.humidity ?? "--"}<small> %RH</small></strong></div>
            <p>{!telemetry ? "等待遥测" : telemetry.enabled.dht ? "温湿度采集中" : "采集已停用"}</p>
          </article>
          <article className={`sensor-card ${telemetry?.enabled.mq2 ? "enabled" : "disabled"} ${telemetry?.sensors.smokeAlarm ? "alarm" : ""}`}>
            <div className="sensor-card-head"><span>MQ-2</span><span className="sensor-readonly">只读</span></div>
            <div className="sensor-values"><strong>{telemetry?.sensors.smoke ?? "--"}<small> RAW</small></strong><span className={`sensor-badge ${telemetry?.sensors.smokeAlarm ? "danger" : ""}`}>{telemetry?.sensors.smokeAlarm ? "报警" : "正常"}</span></div>
            <p>{!telemetry ? "等待遥测" : telemetry.enabled.mq2 ? "数字报警低电平触发" : "采集已停用"}</p>
          </article>
          <article className={`sensor-card ${telemetry?.enabled.light ? "enabled" : "disabled"}`}>
            <div className="sensor-card-head"><span>光敏传感器</span><span className="sensor-readonly">只读</span></div>
            <div className="sensor-values"><strong>{telemetry?.sensors.light ?? "--"}<small> RAW</small></strong><strong>{telemetry?.sensors.lightPercent?.toFixed(0) ?? "--"}<small> %</small></strong></div>
            <p>{!telemetry ? "等待遥测" : telemetry.sensors.lightTriggered ? "检测到黑暗环境" : telemetry.enabled.light ? "当前环境明亮" : "采集已停用"}</p>
          </article>
          <article className={`sensor-card ${telemetry?.enabled.distance ? "enabled" : "disabled"}`}>
            <div className="sensor-card-head"><span>HC-SR04</span><span className="sensor-readonly">只读</span></div>
            <div className="sensor-values"><strong>{telemetry?.sensors.distance ?? "--"}<small> cm</small></strong></div>
            <p>{!telemetry ? "等待遥测" : telemetry.sensors.distance === null ? "超出量程或等待回波" : telemetry.enabled.distance ? "距离实时测量" : "采集已停用"}</p>
          </article>
        </div>
        <div className="output-strip">
          <span>下位机输出状态</span>
          {(["led1", "led2", "buzzer"] as const).map((output) => <b className={telemetry?.outputs[output] !== "off" ? "active" : ""} key={output}>{output.toUpperCase()} · {telemetry?.outputs[output] ?? "未知"}</b>)}
          <small>{telemetryReceivedAt ? `最近遥测 ${new Date(telemetryReceivedAt).toLocaleTimeString("zh-CN", { hour12: false })}` : "尚未收到 JSON 遥测"}</small>
        </div>
        <div className="oled-panel">
          <div className="oled-panel-heading">
            <div>
              <span>OLED DISPLAY</span>
              <strong>屏幕页面控制</strong>
            </div>
            <small>{telemetry?.oled.auto ? "自动轮播中 · 每 8 秒" : `当前：${oledPages[telemetry?.oled.page ?? 0]?.label ?? "未知页面"}`}</small>
          </div>
          <div className="oled-page-buttons">
            <button type="button" disabled={sendingId !== null} onClick={() => void sendOledCommand("oled.prev", "到上一页")}>← 上一页</button>
            {oledPages.map((item) => (
              <button
                type="button"
                key={item.command}
                className={!telemetry?.oled.auto && telemetry?.oled.page === item.page ? "active" : ""}
                disabled={sendingId !== null}
                onClick={() => void sendOledCommand(item.command, `到“${item.label}”`, item.page)}
              >
                {item.label}
              </button>
            ))}
            <button type="button" disabled={sendingId !== null} onClick={() => void sendOledCommand("oled.next", "到下一页")}>下一页 →</button>
            <button
              type="button"
              className={telemetry?.oled.auto ? "active auto" : "auto"}
              disabled={sendingId !== null}
              onClick={() => void sendOledCommand(telemetry?.oled.auto ? "oled.manual" : "oled.auto", telemetry?.oled.auto ? "为手动模式" : "为自动轮播")}
            >
              {telemetry?.oled.auto ? "停止轮播" : "自动轮播"}
            </button>
          </div>
          <p>天气由心知天气在 ESP32 端通过 HTTPS 获取；私钥不会发送到网页。OLED 采用英文短标签显示，避免 128×64 屏幕中文字库占用过大。</p>
        </div>
        {!telemetry && lastSync !== "尚未同步" && (
          <div className="telemetry-diagnostic" role="status">
            <strong>云端暂时没有遥测数据</strong>
            <span>请确认 ESP32 已刷入本项目固件、Wi-Fi 与巴法云已连接，并将 JSON 状态发布到 <code>{config.publishTopic.trim() || "基础主题"}/up</code>。网页读取的订阅主题保持为基础主题即可。</span>
          </div>
        )}
      </section>

      <section className="controls-section">
        <div className="section-heading">
          <div><span className="section-index">03</span><h2>快捷控制</h2></div>
          <div className="control-heading-actions">
            <button className="command-list-button" type="button" onClick={() => setCommandsOpen(true)}>⌘ 指令列表</button>
            <button className="add-button" type="button" onClick={() => setEditingButton({ ...emptyButton })}>
              <span>＋</span> 新建按钮
            </button>
          </div>
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

        <div className={`ble-keypad-panel ${telemetry?.keyboardConnected ? "connected" : ""}`}>
          <div className="ble-keypad-copy">
            <span className="ble-keypad-eyebrow">BLUETOOTH HID</span>
            <h3>电脑数字键盘</h3>
            <div className="ble-keypad-status">
              <i />
              <strong>{telemetry?.keyboardConnected ? "已连接电脑" : "等待电脑连接"}</strong>
            </div>
            <p>先在电脑蓝牙设置中配对 <code>ESP32 Web Keypad</code>，如提示请输入配对码 <code>123456</code>。随后在电脑中选中任意输入框，点击右侧数字即可输入。</p>
          </div>
          <div className="ble-keypad-grid" aria-label="蓝牙数字键盘">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((digit) => (
              <button
                type="button"
                key={digit}
                disabled={!telemetry?.keyboardConnected || sendingId !== null}
                onClick={() => void sendKeyboardDigit(digit)}
                aria-label={`通过蓝牙键盘输入 ${digit}`}
              >
                {sendingId === `keyboard:${digit}` ? <span>···</span> : digit}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="chains-section">
        <div className="section-heading">
          <div><span className="section-index">04</span><h2>条件动作链</h2></div>
          <button className="add-button chain-add" type="button" onClick={() => setEditingChain(createChain())}>
            <span>＋</span> 新建动作链
          </button>
        </div>

        <div className="chain-notice">
          <span className="notice-icon">⌁</span>
          <p><strong>自动条件判断</strong> · 多个条件按 AND 组合；从“不满足”变为“满足”时触发，动作按顺序执行。</p>
          <small>{activeChainCount > 0 ? `${activeChainCount} 条动作链正在运行` : "自动执行期间请保持网页打开"}</small>
        </div>

        {chains.length === 0 ? (
          <button className="chain-empty" type="button" onClick={() => setEditingChain(createChain())}>
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
                    <span className="chain-index">{chain.source === "default" ? "DEFAULT" : "USER"} · CHAIN {String(index + 1).padStart(2, "0")}</span>
                    <div className="chain-head-actions">
                      <button type="button" onClick={() => toggleChainEnabled(chain)}>{chain.enabled ? "停用" : "启用"}</button>
                      <button type="button" onClick={() => chain.source === "default" ? duplicateChain(chain) : editChain(chain)}>{chain.source === "default" ? "复制" : "编辑"}</button>
                    </div>
                  </div>
                  <div className="chain-title-row">
                    <div><h3>{chain.name}</h3><p>{chain.scheduleTime ? `每天 ${chain.scheduleTime} · ` : ""}{chain.conditions.length} 个 AND 条件 · {chain.actions.length} 个动作 · 冷却 {chain.cooldownSeconds} 秒</p></div>
                    <span className={`chain-state ${isActive ? "active" : ""}`}>
                      {run?.status === "waiting" ? "等待中" : run?.status === "sending" ? "发送中" : run?.status === "paused" ? "已暂停" : run?.status === "completed" ? "已完成" : run?.status === "error" ? "执行失败" : "未启动"}
                    </span>
                  </div>

                  <div className="condition-summary">
                    <span>当</span>
                    {chain.scheduleTime ? <code>每天 {chain.scheduleTime}</code> : null}
                    {chain.conditions.map((condition, conditionIndex) => <code key={condition.id}>{conditionIndex > 0 ? "且 " : ""}{conditionLabel(condition)}</code>)}
                  </div>

                  <ol className="chain-action-list">
                    {chain.actions.map((action, actionIndex) => (
                      <li className={run && actionIndex === run.currentIndex && isActive ? "current" : run && actionIndex < run.currentIndex ? "done" : ""} key={action.id}>
                        <span className="action-node">{run && actionIndex < run.currentIndex ? "✓" : actionIndex + 1}</span>
                        <span><small>{actionTimingLabel(action)}{action.condition ? ` · 仅当 ${conditionLabel(action.condition)}` : ""}</small><code>{action.message}</code></span>
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
                    {!run ? <><span>触发状态</span><strong>{chain.enabled ? (chain.scheduleTime ? `等待每天 ${chain.scheduleTime} 且条件满足` : "等待条件满足") : "规则已停用"}</strong></> : null}
                  </div>
                  <div className="chain-card-actions">
                    {!isActive || run?.status === "completed" || run?.status === "error" ? (
                      <button className="chain-primary" type="button" disabled={!chain.enabled} onClick={() => startChain(chain)}>▶ 手动测试</button>
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
          <div><span className="section-index">05</span><h2>消息订阅</h2></div>
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

      {commandsOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) setCommandsOpen(false); }}>
          <section className="button-modal command-modal" role="dialog" aria-modal="true" aria-labelledby="command-modal-title">
            <div className="modal-heading">
              <div><span>DEVICE COMMANDS</span><h2 id="command-modal-title">当前全部指令</h2></div>
              <button type="button" onClick={() => setCommandsOpen(false)} aria-label="关闭">×</button>
            </div>
            <p className="command-modal-intro">这些指令与当前 ESP32-S3 固件一致，可直接发送，也可用于自定义按钮和动作链。</p>
            <div className="command-list">
              {(["输出控制", "传感器控制", "OLED 显示", "蓝牙键盘", "系统指令", "兼容指令"] as DeviceCommand["group"][]).map((group) => (
                <div className="command-group" key={group}>
                  <h3>{group}</h3>
                  {deviceCommands.filter((item) => item.group === group).map((item) => (
                    <div className="command-row" key={item.command}>
                      <div><code>{item.command}</code><span>{item.description}</span></div>
                      <button type="button" disabled={sendingId !== null} onClick={() => void sendCatalogCommand(item.command)}>
                        {sendingId === `command:${item.command}` ? "发送中…" : "发送"}
                      </button>
                    </div>
                  ))}
                </div>
              ))}
            </div>
            <div className="command-modal-note">闪烁周期可修改，例如 <code>led1.blink:800</code>；建议不低于 100 ms。</div>
          </section>
        </div>
      )}

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
              <input autoFocus value={editingChain.name} onChange={(event) => setEditingChain({ ...editingChain, name: event.target.value })} placeholder="例如：近距离自动报警" />
            </label>

            <div className="rule-meta-fields">
              <label className="field">
                <span>再次触发冷却时间</span>
                <div className="suffix-input"><input type="number" min="1" value={editingChain.cooldownSeconds} onChange={(event) => setEditingChain({ ...editingChain, cooldownSeconds: Number(event.target.value) })} /><i>秒</i></div>
              </label>
              <label className="rule-enable"><input type="checkbox" checked={editingChain.enabled} onChange={(event) => setEditingChain({ ...editingChain, enabled: event.target.checked })} /><span>保存后立即启用</span></label>
            </div>

            <div className="chain-schedule">
              <label className="rule-enable">
                <input
                  type="checkbox"
                  checked={editingChain.scheduleTime !== null}
                  onChange={(event) => setEditingChain({ ...editingChain, scheduleTime: event.target.checked ? "08:00" : null })}
                />
                <span>每天定时触发</span>
              </label>
              {editingChain.scheduleTime !== null ? (
                <label className="field">
                  <span>触发时刻</span>
                  <input type="time" value={editingChain.scheduleTime} onChange={(event) => setEditingChain({ ...editingChain, scheduleTime: event.target.value })} />
                </label>
              ) : <small>关闭时仅由下方传感器条件触发</small>}
            </div>

            <div className="chain-editor-heading">
              <div><strong>触发条件</strong><small>所有条件同时满足（AND）时触发</small></div>
              <span>{editingChain.conditions.length} CONDITIONS</span>
            </div>
            <div className="condition-editor-list">
              {editingChain.conditions.map((condition, index) => {
                const booleanMetric = condition.metric === "smokeAlarm" || condition.metric === "lightTriggered";
                return (
                  <div className="condition-editor" key={condition.id}>
                    <b>{index === 0 ? "当" : "且"}</b>
                    <select value={condition.metric} onChange={(event) => {
                      const metric = event.target.value as SensorMetric;
                      updateEditingCondition(condition.id, { metric, value: metric === "smokeAlarm" || metric === "lightTriggered" ? 1 : condition.value });
                    }}>
                      {(Object.keys(metricLabels) as SensorMetric[]).map((metric) => <option value={metric} key={metric}>{metricLabels[metric]}</option>)}
                    </select>
                    <select value={condition.operator} onChange={(event) => updateEditingCondition(condition.id, { operator: event.target.value as ConditionOperator })}>
                      <option value="<">小于</option><option value="<=">小于等于</option><option value=">">大于</option><option value=">=">大于等于</option><option value="==">等于</option><option value="!=">不等于</option>
                    </select>
                    {booleanMetric ? (
                      <select value={condition.value} onChange={(event) => updateEditingCondition(condition.id, { value: Number(event.target.value) })}><option value={1}>是</option><option value={0}>否</option></select>
                    ) : (
                      <input type="number" step="0.1" value={condition.value} onChange={(event) => updateEditingCondition(condition.id, { value: Number(event.target.value) })} />
                    )}
                    <button type="button" disabled={editingChain.conditions.length === 1} onClick={() => removeEditingCondition(condition.id)}>×</button>
                  </div>
                );
              })}
            </div>
            <button className="append-condition" type="button" onClick={() => setEditingChain({ ...editingChain, conditions: [...editingChain.conditions, createCondition()] })}>＋ 添加 AND 条件</button>

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
                          <input type="number" min="0" step="1" value={action.delayValue} onChange={(event) => updateEditingAction(action.id, { delayValue: Number(event.target.value) })} />
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
                      <input value={action.message} onChange={(event) => updateEditingAction(action.id, { message: event.target.value })} placeholder="例如：led1.blink:500" list="command-options" />
                    </label>
                  </div>
                  <div className="action-condition-block">
                    <label className="rule-enable">
                      <input
                        type="checkbox"
                        checked={action.condition !== null}
                        onChange={(event) => updateEditingAction(action.id, { condition: event.target.checked ? createCondition() : null })}
                      />
                      <span>执行这个动作前再次判断传感器条件</span>
                    </label>
                    {action.condition ? (
                      <div className="condition-editor action-condition-editor">
                        <b>若</b>
                        <select value={action.condition.metric} onChange={(event) => {
                          const metric = event.target.value as SensorMetric;
                          updateEditingAction(action.id, {
                            condition: {
                              ...action.condition!,
                              metric,
                              value: metric === "smokeAlarm" || metric === "lightTriggered" ? 1 : action.condition!.value,
                            },
                          });
                        }}>
                          {(Object.keys(metricLabels) as SensorMetric[]).map((metric) => <option value={metric} key={metric}>{metricLabels[metric]}</option>)}
                        </select>
                        <select value={action.condition.operator} onChange={(event) => updateEditingAction(action.id, { condition: { ...action.condition!, operator: event.target.value as ConditionOperator } })}>
                          <option value="<">小于</option><option value="<=">小于等于</option><option value=">">大于</option><option value=">=">大于等于</option><option value="==">等于</option><option value="!=">不等于</option>
                        </select>
                        {action.condition.metric === "smokeAlarm" || action.condition.metric === "lightTriggered" ? (
                          <select value={action.condition.value} onChange={(event) => updateEditingAction(action.id, { condition: { ...action.condition!, value: Number(event.target.value) } })}><option value={1}>是</option><option value={0}>否</option></select>
                        ) : (
                          <input type="number" step="0.1" value={action.condition.value} onChange={(event) => updateEditingAction(action.id, { condition: { ...action.condition!, value: Number(event.target.value) } })} />
                        )}
                      </div>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>

            <button className="append-action" type="button" onClick={() => setEditingChain({ ...editingChain, actions: [...editingChain.actions, createAction()] })}>
              <span>＋</span><strong>添加下一个动作</strong><small>可继续设置等待时间或指定时刻</small>
            </button>

            <datalist id="command-options">
              {deviceCommands.map((item) => <option value={item.command} key={item.command} />)}
            </datalist>

            <div className="chain-editor-note"><span>i</span>用户动作链保存在当前浏览器；自动判断由网页执行，关闭网页会暂停规则。</div>

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
