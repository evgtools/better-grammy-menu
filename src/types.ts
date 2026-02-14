import { Context, SessionFlavor } from "grammy";
import type { Menu } from "./index.js";
import { InlineKeyboardButton, ParseMode } from "grammy/types";

export type MaybePromise<T> = Promise<T> | T;

export type MenuContext<ContextType extends Context = Context> =
  SessionFlavor<any> & ContextType;

export type InitStateFn<StateType> = () => MaybePromise<StateType>;

export type OnEnterFn<ContextType extends MenuContext, StateType> = (
  ctx: WithState<ContextType, StateType>,
) => MaybePromise<any>;

export type State<StateType> = {
  get: <K extends keyof StateType>(key: K) => StateType[K];
  set: <K extends keyof StateType>(
    key: K,
    value: StateType[K] | ((prev: StateType[K]) => StateType[K]),
  ) => any;
  reset: () => any;
};

export type MenuNavigationArgs<LoaderArgumentsType> = [
  LoaderArgumentsType,
] extends [void]
  ? [args?: LoaderArgumentsType]
  : [undefined] extends [LoaderArgumentsType]
    ? [args?: LoaderArgumentsType]
    : [args: LoaderArgumentsType];

export type MenuCallbackActions<LoaderArgumentsType> = {
  refresh: (args?: Partial<LoaderArgumentsType>) => Promise<any>;
  navigate: <L2>(
    menu: Menu<any, any, L2, any>,
    ...args: MenuNavigationArgs<L2>
  ) => Promise<any>;
};

export type WithActions<
  ContextType extends MenuContext = MenuContext,
  LoaderArgumentsType = any,
> = ContextType & {
  menu: MenuCallbackActions<LoaderArgumentsType>;
};

export type WithState<
  ContextType extends MenuContext = MenuContext,
  StateType = void,
> = ContextType &
  (StateType extends void
    ? {}
    : { menu: { state: State<NonNullable<StateType>> } });

export type LoaderFn<
  ContextType extends MenuContext,
  StateType,
  LoaderArgumentsType,
  LoaderDataType,
> = (
  ctx: WithState<ContextType, StateType>,
  args: LoaderArgumentsType,
) => MaybePromise<
  { text: string; parseMode?: ParseMode } & (LoaderDataType extends void
    ? { data?: never }
    : { data: LoaderDataType })
>;

export type MenuCallbackContext<
  ContextType extends MenuContext = MenuContext,
  StateType = void,
  LoaderArgumentsType = void,
> = WithActions<ContextType, LoaderArgumentsType> &
  WithState<ContextType, StateType>;

export type MenuCallbackFn<
  ContextType extends MenuContext,
  StateType,
  LoaderArgumentsType,
  LoaderDataType,
> = (
  ctx: MenuCallbackContext<ContextType, StateType, LoaderArgumentsType>,
  data: LoaderDataType,
) => MaybePromise<any>;

export type MenuDynamicFn<
  ContextType extends MenuContext,
  StateType,
  LoaderArgumentsType,
  LoaderDataType,
> = (
  ctx: WithState<ContextType, StateType>,
  builder: KeyboardBuilder<
    ContextType,
    StateType,
    LoaderArgumentsType,
    LoaderDataType
  >,
  data: LoaderDataType,
) => MaybePromise<any>;

export type Action = "callback";

export type ActionHandler = {
  action: string;
  callbackFn?: MenuCallbackFn<any, any, any, any>;
};

export type BuildStep<
  ContextType extends MenuContext,
  StateType,
  LoaderArgumentsType,
  LoaderDataType,
> =
  | {
      scope: "dynamic";
      dynamicFn: MenuDynamicFn<
        ContextType,
        StateType,
        LoaderArgumentsType,
        LoaderDataType
      >;
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

export interface KeyboardBuilder<
  ContextType extends MenuContext = MenuContext,
  StateType = void,
  LoaderArgumentsType = void,
  LoaderDataType = void,
> {
  callback: (
    text: string,
    callbackFn?: MenuCallbackFn<
      ContextType,
      StateType,
      LoaderArgumentsType,
      LoaderDataType
    >,
  ) => KeyboardBuilder<
    ContextType,
    StateType,
    LoaderArgumentsType,
    LoaderDataType
  >;
  copy: (
    text: string,
    content: string,
  ) => KeyboardBuilder<
    ContextType,
    StateType,
    LoaderArgumentsType,
    LoaderDataType
  >;
  url: (
    text: string,
    url: string | URL,
  ) => KeyboardBuilder<
    ContextType,
    StateType,
    LoaderArgumentsType,
    LoaderDataType
  >;
  row: () => KeyboardBuilder<
    ContextType,
    StateType,
    LoaderArgumentsType,
    LoaderDataType
  >;
  dynamic: (
    dynamicFn: MenuDynamicFn<
      ContextType,
      StateType,
      LoaderArgumentsType,
      LoaderDataType
    >,
  ) => KeyboardBuilder<
    ContextType,
    StateType,
    LoaderArgumentsType,
    LoaderDataType
  >;
}
