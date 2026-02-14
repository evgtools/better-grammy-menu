import { InlineKeyboard, type MiddlewareFn } from "grammy";
import type { InlineKeyboardButton, ParseMode } from "grammy/types";
import { nanoid } from "nanoid";
import type {
  Action,
  ActionHandler,
  BuildStep,
  InitStateFn,
  KeyboardBuilder,
  LoaderFn,
  MaybePromise,
  MenuCallbackActions,
  MenuCallbackFn,
  MenuContext,
  MenuDynamicFn,
  MenuNavigationArgs,
  MenuOptions,
  OnEnterFn,
  State,
  WithState,
  WithActions,
  MenuCallbackContext,
} from "./types.js";

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
  ContextType extends MenuContext,
  StateType,
  LoaderArgumentsType,
  LoaderDataType,
> implements
    KeyboardBuilder<
      ContextType,
      StateType,
      LoaderArgumentsType,
      LoaderDataType
    >
{
  private readonly menuId: string;
  private steps: BuildStep<
    ContextType,
    StateType,
    LoaderArgumentsType,
    LoaderDataType
  >[];

  constructor(menuId: string) {
    this.menuId = menuId;
    this.steps = [];
  }

  callback(
    text: string,
    callbackFn?: MenuCallbackFn<
      ContextType,
      StateType,
      LoaderArgumentsType,
      LoaderDataType
    >,
  ) {
    const targetId = nanoid(6);
    const action = buildAction("callback", this.menuId, targetId);

    this.steps.push({
      scope: "static",
      buttons: [InlineKeyboard.text(text, action)],
      handler: { action, callbackFn },
    });

    return this;
  }

  copy(text: string, content: string) {
    this.steps.push({
      scope: "static",
      buttons: [InlineKeyboard.copyText(text, content)],
    });

    return this;
  }

  url(text: string, url: string | URL) {
    this.steps.push({
      scope: "static",
      buttons: [InlineKeyboard.url(text, url.toString())],
    });

    return this;
  }

  row() {
    this.steps.push({
      scope: "static",
      buttons: [[]],
    });

    return this;
  }

  dynamic(
    dynamicFn: MenuDynamicFn<
      ContextType,
      StateType,
      LoaderArgumentsType,
      LoaderDataType
    >,
  ) {
    this.steps.push({ scope: "dynamic", dynamicFn });

    return this;
  }

  prepare() {
    return {
      staticActionHandlers: this.steps
        .filter((step) => step.scope === "static" && step.handler)
        .map((step) => step.handler) as ActionHandler[],
    };
  }

  async build(ctx: WithState<ContextType, StateType>, data: LoaderDataType) {
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

      const builder = new LayoutBuilder<
        ContextType,
        StateType,
        LoaderArgumentsType,
        LoaderDataType
      >(this.menuId);
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
  ContextType extends MenuContext,
  StateType,
  LoaderArgumentsType,
  LoaderDataType,
> {
  readonly id: string;
  private readonly loaderFn: LoaderFn<
    ContextType,
    StateType,
    LoaderArgumentsType,
    LoaderDataType
  >;
  private readonly initStateFn?: InitStateFn<StateType>;
  private readonly onEnterFn?: OnEnterFn<ContextType, StateType>;
  private readonly staticActionHandlersByAction: Map<string, ActionHandler>;
  private readonly dynamicActionHandlersByActionByChatId: Map<
    string,
    Map<string, ActionHandler>
  >;
  private readonly builder: LayoutBuilder<
    ContextType,
    StateType,
    LoaderArgumentsType,
    LoaderDataType
  >;
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
    state,
    options,
    onEnter,
  }: {
    id: string;
    loader: LoaderFn<
      ContextType,
      StateType,
      LoaderArgumentsType,
      LoaderDataType
    >;
    builder: LayoutBuilder<
      ContextType,
      StateType,
      LoaderArgumentsType,
      LoaderDataType
    >;
    state?: InitStateFn<StateType>;
    options?: MenuOptions;
    onEnter?: OnEnterFn<ContextType, StateType>;
  }) {
    this.id = id;
    this.loaderFn = loader;
    this.initStateFn = state;
    const { staticActionHandlers } = builder.prepare();
    const staticActionHandlerMap = new Map<string, ActionHandler>();
    staticActionHandlers.forEach((actionHandler) => {
      staticActionHandlerMap.set(actionHandler.action, actionHandler);
    });
    this.staticActionHandlersByAction = staticActionHandlerMap;
    this.dynamicActionHandlersByActionByChatId = new Map();
    this.builder = builder;
    this.onEnterFn = onEnter;
    this.options = options;
  }

  private initContext(ctx: ContextType) {
    (ctx as any).menu ??= {};
    ctx.session._menu ??= {};
    ctx.session._menu[this.id] ??= {};
  }

  private async getCallbackActions(ctx: ContextType) {
    const actions: MenuCallbackActions<LoaderArgumentsType> = {
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

  private async getState(ctx: ContextType) {
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
      reset: async () => {
        ctx.session._menu[this.id].state = await Promise.resolve(
          this.initStateFn?.(),
        );
      },
    };

    return state;
  }

  private async buildLayout(ctx: ContextType, args: LoaderArgumentsType) {
    this.initContext(ctx);

    const state = await this.getState(ctx);
    if (state) (ctx as any).menu.state = state;

    await Promise.resolve(
      this.onEnterFn?.(ctx as WithState<ContextType, StateType>),
    );

    const { text, data, parseMode } = await Promise.race([
      Promise.resolve(
        this.loaderFn(ctx as WithState<ContextType, StateType>, args),
      ),
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
      data as LoaderDataType,
    );

    const dynamicActionHandlerMap = new Map();
    dynamicHandlers.forEach((actionHandler) => {
      dynamicActionHandlerMap.set(actionHandler.action, actionHandler);
    });
    this.dynamicActionHandlersByActionByChatId.set(
      ctx.chat?.id.toString() ?? "",
      dynamicActionHandlerMap,
    );

    ctx.session._menu.activeMenuLoaderArgs = args;
    ctx.session._menu.activeMenuLoaderData = data;

    return { text, keyboard, parseMode };
  }

  middleware: MiddlewareFn<ContextType> = async (ctx, next) => {
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

  async render(ctx: ContextType, args: LoaderArgumentsType) {
    const { text, keyboard, parseMode } = await this.buildLayout(ctx, args);
    await ctx.editMessageText(text, {
      parse_mode: parseMode,
      reply_markup: { inline_keyboard: keyboard },
    });
  }

  async send(
    ctx: ContextType,
    ...args: MenuNavigationArgs<LoaderArgumentsType>
  ) {
    try {
      const { keyboard, text, parseMode } = await this.buildLayout(
        ctx,
        args[0] as LoaderArgumentsType,
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
  StateType = void,
  LoaderArgumentsType = void,
  LoaderDataType = void,
>(data: {
  loader: LoaderFn<ContextType, StateType, LoaderArgumentsType, LoaderDataType>;
  onEnter?: OnEnterFn<ContextType, StateType>;
  layout: (
    builder: KeyboardBuilder<
      ContextType,
      StateType,
      LoaderArgumentsType,
      LoaderDataType
    >,
  ) => void;
  state?: StateType extends void
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
    ...data,
    id,
    builder,
  });
};

export const createMenuFactory = <ContextType extends MenuContext>(
  defaultOptions?: MenuOptions,
) => {
  return <
    StateType = void,
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
    state?: StateType extends void
      ? never
      : () => MaybePromise<NonNullable<StateType>>;
    onEnter?: OnEnterFn<ContextType, StateType>;
    options?: MenuOptions;
  }): Menu<ContextType, StateType, LoaderArgumentsType, LoaderDataType> => {
    return createMenu<
      ContextType,
      StateType,
      LoaderArgumentsType,
      LoaderDataType
    >({
      ...data,
      options: {
        ...(defaultOptions ?? {}),
        ...(data.options ?? {}),
      },
    });
  };
};

export type {
  Action,
  ActionHandler,
  BuildStep,
  InitStateFn,
  KeyboardBuilder,
  LoaderFn,
  MaybePromise,
  MenuCallbackActions,
  MenuCallbackFn,
  MenuContext,
  MenuDynamicFn,
  MenuNavigationArgs,
  MenuOptions,
  OnEnterFn,
  State,
  WithState,
  WithActions,
  MenuCallbackContext,
} from "./types.js";
