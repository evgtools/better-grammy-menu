import {
  Context,
  InlineKeyboard,
  type MiddlewareFn,
  type SessionFlavor,
} from "grammy";
import type { InlineKeyboardButton, ParseMode } from "grammy/types";
import { nanoid } from "nanoid";

export type MenuContext<C extends Context = Context> = SessionFlavor<any> & C;
type MaybePromise<T> = Promise<T> | T;
type InitStateFn<S> = () => MaybePromise<S>;
type State<S extends Record<string, any>> = {
  get: <K extends keyof S>(key: K) => S[K];
  set: <K extends keyof S>(
    key: K,
    value: S[K] | ((prev: S[K]) => S[K]),
  ) => void;
  reset: () => void;
};
type MenuNavigationArgs<L> = [L] extends [void]
  ? [args?: L]
  : undefined extends L
    ? [args?: L]
    : {} extends L
      ? [args?: L]
      : [args: L];
type MenuCallbackActions<L> = {
  refresh: (args?: Partial<L>) => Promise<void>;
  navigate: <L2>(
    menu: Menu<any, any, L2, any>,
    ...args: MenuNavigationArgs<L2>
  ) => Promise<void>;
};
export type WithActions<C extends MenuContext = MenuContext, L = any> = C & {
  menu: MenuCallbackActions<L>;
};
export type WithState<C extends MenuContext = MenuContext, S = void> = C &
  (S extends void ? {} : { menu: { state: State<NonNullable<S>> } });
type LoaderFn<
  C extends MenuContext,
  S extends Record<string, any> | void,
  L,
  D,
> = (
  ctx: WithState<C, S>,
  args: L,
) => MaybePromise<
  { text: string; parseMode?: ParseMode } & (D extends void
    ? { data?: never }
    : { data: D })
>;
export type MenuCallbackContext<
  C extends MenuContext = MenuContext,
  S extends Record<string, any> | void = void,
  L = void,
> = WithActions<C, L> & WithState<C, S>;
type MenuCallbackFn<
  C extends MenuContext,
  S extends Record<string, any> | void,
  L,
  D,
> = (ctx: MenuCallbackContext<C, S, L>, data: D) => MaybePromise<void>;
type MenuDynamicFn<
  C extends MenuContext,
  S extends Record<string, any> | void,
  L,
  D,
> = (
  ctx: WithState<C, S>,
  builder: Omit<LayoutBuilder<C, S, L, D>, "prepare" | "build">,
  data: D,
) => MaybePromise<void>;
type Action = "callback";
type ActionHandler = {
  action: string;
  callbackFn?: MenuCallbackFn<any, any, any, any>;
};
type BuildStep<
  C extends MenuContext,
  S extends Record<string, any> | void,
  L,
  D,
> =
  | {
      scope: "dynamic";
      dynamicFn: MenuDynamicFn<C, S, L, D>;
      buttons?: never;
      handler?: never;
    }
  | {
      scope: "static";
      dynamicFn?: never;
      buttons: InlineKeyboardButton[] | InlineKeyboardButton[][];
      handler?: ActionHandler;
    };
export type MenuOptions = {
  staleErrorText?: string;
  timeoutErrorText?: string;
  timeoutMs?: number;
};
export type KeyboardBuilder<
  C extends MenuContext = MenuContext,
  S extends Record<string, any> | void = void,
  L = void,
  D = void,
> = Pick<
  LayoutBuilder<C, S, L, D>,
  "callback" | "copy" | "url" | "row" | "dynamic"
>;

const MENU_PREFIX = "eijdfwof";
const ACTION_REPRESENTATION_MAPPING = {
  callback: "call",
} as const satisfies Record<Action, string>;

const buildAction = (action: Action, sourceId: string, targetId?: string) => {
  return `${MENU_PREFIX}:${sourceId}:${ACTION_REPRESENTATION_MAPPING[action]}${targetId ? `:${targetId}` : ""}`;
};

const parseAction = (
  actionString: string,
): { action: Action; sourceId: string; targetId?: string } | null => {
  const [menuPrefix, sourceId, action, targetId] = actionString.split(":");

  if (menuPrefix !== MENU_PREFIX) {
    return null;
  }

  if (
    !Object.values(ACTION_REPRESENTATION_MAPPING).includes(
      action ?? ("" as any),
    )
  ) {
    return null;
  }

  if (!sourceId) {
    return null;
  }

  return {
    action: Object.entries(ACTION_REPRESENTATION_MAPPING).find(
      ([_, v]) => v === action,
    )?.[0] as Action,
    sourceId,
    targetId,
  };
};

export class LayoutBuilder<
  C extends MenuContext,
  S extends Record<string, any> | void,
  L,
  D,
> {
  private readonly menuId: string;
  private steps: BuildStep<C, S, L, D>[];

  constructor(menuId: string) {
    this.menuId = menuId;
    this.steps = [];
  }

  callback(text: string, callbackFn?: MenuCallbackFn<C, S, L, D>) {
    const targetId = nanoid(6);
    const action = buildAction("callback", this.menuId, targetId);

    this.steps.push({
      scope: "static",
      buttons: [InlineKeyboard.text(text, action)],
      handler: { action, callbackFn },
    });
  }

  copy(text: string, content: string) {
    this.steps.push({
      scope: "static",
      buttons: [InlineKeyboard.copyText(text, content)],
    });
  }

  url(text: string, url: string | URL) {
    this.steps.push({
      scope: "static",
      buttons: [InlineKeyboard.url(text, url.toString())],
    });
  }

  row() {
    this.steps.push({
      scope: "static",
      buttons: [[]],
    });
  }

  dynamic(dynamicFn: MenuDynamicFn<C, S, L, D>) {
    this.steps.push({ scope: "dynamic", dynamicFn });
  }

  prepare() {
    return {
      staticActionHandlers: this.steps
        .filter((step) => step.scope === "static" && step.handler)
        .map((step) => step.handler) as ActionHandler[],
    };
  }

  async build(ctx: WithState<C, S>, data: D) {
    const keyboard: InlineKeyboardButton[][] = [[]];
    const staticHandlers: ActionHandler[] = [];
    const dynamicHandlers: ActionHandler[] = [];

    for (const { scope, buttons, dynamicFn, handler } of this.steps) {
      if (scope === "static") {
        for (const button of buttons) {
          if (Array.isArray(button)) {
            keyboard.push([...button]);
          } else {
            keyboard[keyboard.length - 1]!.push(button);
          }
        }

        if (handler) {
          staticHandlers.push(handler);
        }
        continue;
      }

      const builder = new LayoutBuilder<C, S, L, D>(this.menuId);
      await Promise.resolve(dynamicFn(ctx, builder, data));
      const dynamicBuild = await builder.build(ctx, data);
      dynamicHandlers.push(
        ...dynamicBuild.staticHandlers,
        ...dynamicBuild.dynamicHandlers,
      );

      if (dynamicBuild.keyboard.length > 0) {
        const [row, ...restRows] = dynamicBuild.keyboard;
        if (row) {
          keyboard[keyboard.length - 1]!.push(...row);
        }

        if (restRows.length > 0) {
          keyboard.push(...restRows);
        }
      }
    }

    return {
      keyboard: keyboard.filter((row) => row.length > 0),
      staticHandlers,
      dynamicHandlers,
    };
  }
}

export class Menu<
  C extends MenuContext,
  S extends Record<string, any> | void,
  L,
  D,
> {
  readonly id: string;
  private readonly loaderFn: LoaderFn<C, S, L, D>;
  private readonly initStateFn?: InitStateFn<S>;
  private readonly staticActionHandlersByAction: Map<string, ActionHandler>;
  private readonly dynamicActionHandlersByActionByChatId: Map<
    string,
    Map<string, ActionHandler>
  >;
  private readonly builder: LayoutBuilder<C, S, L, D>;
  private readonly options?: MenuOptions;
  private readonly defaultOptions = {
    staleErrorText: "The menu is stalled",
    timeoutErrorText: "The action took too long to execute",
    timeoutMs: 10_000,
  } as const satisfies MenuOptions;

  constructor({
    builder,
    id,
    loader,
    initState,
    options,
  }: {
    id: string;
    loader: LoaderFn<C, S, L, D>;
    builder: LayoutBuilder<C, S, L, D>;
    initState?: InitStateFn<S>;
    options?: MenuOptions;
  }) {
    this.id = id;
    this.loaderFn = loader;
    this.initStateFn = initState;
    const { staticActionHandlers } = builder.prepare();
    const staticActionHandlerMap = new Map<string, ActionHandler>();
    staticActionHandlers.forEach((actionHandler) => {
      staticActionHandlerMap.set(actionHandler.action, actionHandler);
    });
    this.staticActionHandlersByAction = staticActionHandlerMap;
    this.dynamicActionHandlersByActionByChatId = new Map();
    this.builder = builder;
    this.options = options;
  }

  private async getCallbackActions(ctx: C) {
    const actions: MenuCallbackActions<L> = {
      navigate: (
        menu: Menu<any, any, any, any>,
        ...args: MenuNavigationArgs<any>
      ) => menu.render(ctx, args[0] as any),
      refresh: (args) => {
        const sessionArgs = ctx.session._menu.activeMenuLoaderArgs;
        return this.render(
          ctx,
          typeof sessionArgs === "object" && sessionArgs !== null
            ? { ...sessionArgs, ...(args ?? {}) }
            : (args ?? sessionArgs),
        );
      },
    };
    return actions;
  }

  private async buildLayout(ctx: C, args: L) {
    const state = await this.getState(ctx);
    if (state) (ctx as any).menu.state = state;

    const { text, data, parseMode } = await Promise.race([
      Promise.resolve(this.loaderFn(ctx as any, args)),
      new Promise<never>((_, reject) =>
        setTimeout(
          () =>
            reject(
              new Error(
                this.options?.timeoutErrorText ??
                  this.defaultOptions.timeoutErrorText,
              ),
            ),
          this.options?.timeoutMs ?? this.defaultOptions.timeoutMs,
        ),
      ),
    ]);
    const { keyboard, dynamicHandlers } = await this.builder.build(
      ctx as any,
      data as D,
    );
    const dynamicActionHandlerMap = new Map();
    dynamicHandlers.forEach((actionHandler) => {
      dynamicActionHandlerMap.set(actionHandler.action, actionHandler);
    });
    this.dynamicActionHandlersByActionByChatId.set(
      ctx.chat?.id.toString() ?? "",
      dynamicActionHandlerMap,
    );

    // _menu initialized at middleware
    ctx.session._menu.activeMenuLoaderArgs = args;
    ctx.session._menu.activeMenuLoaderData = data;

    return { text, keyboard, parseMode };
  }

  private async getState(ctx: C) {
    if (!ctx.session._menu[this.id].state && !this.initStateFn) {
      return;
    }

    if (!ctx.session._menu[this.id].state && this.initStateFn) {
      ctx.session._menu[this.id].state = await Promise.resolve(
        this.initStateFn?.(),
      );
    }

    const state: State<any> = {
      get: (key) => ctx.session._menu[this.id].state[key],
      set: (key, value) => {
        if (typeof value === "function") {
          ctx.session._menu[this.id].state[key] = value(
            ctx.session._menu[this.id].state[key],
          );
        } else {
          ctx.session._menu[this.id].state[key] = value;
        }
      },
      reset: () => delete ctx.session._menu[this.id].state,
    };

    return state;
  }

  middleware: MiddlewareFn<C> = async (ctx, next) => {
    (ctx as any).menu ??= {};
    ctx.session._menu ??= {};
    ctx.session._menu[this.id] ??= {};

    const callbackQuery = ctx.callbackQuery?.data ?? "";
    const actionHandler =
      this.staticActionHandlersByAction.get(callbackQuery) ??
      this.dynamicActionHandlersByActionByChatId
        .get(ctx.chat?.id.toString() ?? "")
        ?.get(callbackQuery);

    const { action, sourceId, targetId } =
      parseAction(actionHandler?.action ?? "") || {};

    if (!action || !actionHandler || sourceId !== this.id) {
      return next();
    }

    if (
      ctx.callbackQuery?.message?.message_id !==
      ctx.session._menu?.activeMessageId
    ) {
      await ctx
        .answerCallbackQuery({
          show_alert: true,
          text:
            this.options?.staleErrorText ?? this.defaultOptions.staleErrorText,
        })
        .catch(() => null);
      return;
    }

    try {
      if (action === "callback" && actionHandler.callbackFn) {
        (ctx as any).menu = await this.getCallbackActions(ctx);
        const state = await this.getState(ctx);
        if (state) (ctx as any).menu.state = state;

        await Promise.race([
          Promise.resolve(
            actionHandler.callbackFn!(
              ctx,
              ctx.session._menu.activeMenuLoaderData,
            ),
          ),
          new Promise((_, reject) =>
            setTimeout(
              () =>
                reject(
                  new Error(
                    this.options?.timeoutErrorText ??
                      this.defaultOptions.timeoutErrorText,
                  ),
                ),
              this.options?.timeoutMs ?? this.defaultOptions.timeoutMs,
            ),
          ),
        ]);
      }
      await ctx.answerCallbackQuery().catch(() => null);
    } catch (error: any) {
      await ctx
        .answerCallbackQuery({
          text: error.message ?? "Unknown error",
          show_alert: true,
        })
        .catch(() => null);
      throw error;
    }
  };

  async render(ctx: C, args: L) {
    const { text, keyboard, parseMode } = await this.buildLayout(ctx, args);
    await ctx.editMessageText(text, {
      parse_mode: parseMode,
      reply_markup: { inline_keyboard: keyboard },
    });
  }

  async send(ctx: C, ...args: MenuNavigationArgs<L>) {
    try {
      const { keyboard, text, parseMode } = await this.buildLayout(
        ctx,
        args[0] as L,
      );
      const { message_id } = await ctx.reply(text, {
        parse_mode: parseMode,
        reply_markup: { inline_keyboard: keyboard },
      });
      ctx.session._menu.activeMessageId = message_id;
    } catch (error: any) {
      await ctx.reply(error.message);
    }
  }
}
export const createMenu = <
  ContextType extends MenuContext = MenuContext,
  StateType extends Record<string, any> | void = void,
  LoaderArgumentsType = void,
  LoaderDataType = void,
>(data: {
  loader: LoaderFn<ContextType, StateType, LoaderArgumentsType, LoaderDataType>;
  layout: (
    builder: KeyboardBuilder<
      ContextType,
      StateType,
      LoaderArgumentsType,
      LoaderDataType
    >,
  ) => void;
  initState?: StateType extends void
    ? never
    : () => MaybePromise<NonNullable<StateType>>;
  options?: MenuOptions;
}): Menu<ContextType, StateType, LoaderArgumentsType, LoaderDataType> => {
  const id = nanoid(6);
  const builder = new LayoutBuilder<
    ContextType,
    StateType,
    LoaderArgumentsType,
    LoaderDataType
  >(id);

  data.layout(builder);

  return new Menu<ContextType, StateType, LoaderArgumentsType, LoaderDataType>({
    id,
    loader: data.loader,
    initState: data.initState as unknown as InitStateFn<StateType> | undefined,
    builder,
    options: data.options,
  });
};

export const createMenuFactory = <ContextType extends MenuContext>(
  defaultOptions?: MenuOptions,
) => {
  return <
    StateType extends Record<string, any> | void = void,
    LoaderArgumentsType = void,
    LoaderDataType = void,
  >(data: {
    loader: LoaderFn<
      ContextType,
      StateType,
      LoaderArgumentsType,
      LoaderDataType
    >;
    layout: (
      builder: KeyboardBuilder<
        ContextType,
        StateType,
        LoaderArgumentsType,
        LoaderDataType
      >,
    ) => void;
    initState?: StateType extends void
      ? never
      : () => MaybePromise<NonNullable<StateType>>;
    options?: MenuOptions;
  }): Menu<ContextType, StateType, LoaderArgumentsType, LoaderDataType> => {
    const mergedOptions: MenuOptions | undefined =
      defaultOptions || data.options
        ? { ...(defaultOptions ?? {}), ...(data.options ?? {}) }
        : undefined;

    return createMenu<
      ContextType,
      StateType,
      LoaderArgumentsType,
      LoaderDataType
    >({
      ...data,
      options: mergedOptions,
    });
  };
};
