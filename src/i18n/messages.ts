import type { AppLocale } from "./config";

type MessageObject = Record<string, unknown>;

const isMessageObject = (value: unknown): value is MessageObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const mergeMessages = <Base extends MessageObject, Extra extends MessageObject>(
  base: Base,
  extra: Extra,
): Base & Extra => {
  const merged: MessageObject = { ...base };

  for (const [key, value] of Object.entries(extra)) {
    const baseValue = merged[key];
    merged[key] =
      isMessageObject(baseValue) && isMessageObject(value)
        ? mergeMessages(baseValue, value)
        : value;
  }

  return merged as Base & Extra;
};

const localeMessageLoaders: Record<
  AppLocale,
  () => Promise<{ default: MessageObject }>
> = {
  de: () => import("./messages/de.json"),
  en: () => import("./messages/en.json"),
  es: () => import("./messages/es.json"),
  fr: () => import("./messages/fr.json"),
  it: () => import("./messages/it.json"),
  ja: () => import("./messages/ja.json"),
  ko: () => import("./messages/ko.json"),
  pt: () => import("./messages/pt.json"),
  vi: () => import("./messages/vi.json"),
  "zh-Hans": () => import("./messages/zh-Hans.json"),
  "zh-Hant": () => import("./messages/zh-Hant.json"),
};

const messageCache = new Map<AppLocale, Promise<MessageObject>>();

export const loadMessages = (locale: AppLocale): Promise<MessageObject> => {
  const cached = messageCache.get(locale);
  if (cached) {
    return cached;
  }

  const messagesPromise = Promise.all([
    localeMessageLoaders[locale](),
    import("./supplemental-messages"),
  ]).then(([baseMessages, { supplementalMessages }]) =>
    mergeMessages(baseMessages.default, supplementalMessages[locale]),
  );
  messageCache.set(locale, messagesPromise);
  return messagesPromise;
};
