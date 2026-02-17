# better-grammy-menu
A TypeScript-first menu builder for Telegram bots built with [grammY](https://grammy.dev/).

This library exists because the standard [grammyjs/menu](https://github.com/grammyjs/menu) did not cover some features I needed.

## Installation

```bash
npm install @evgtools/better-grammy-menu
```

```bash
bun add @evgtools/better-grammy-menu
```

## Features

- Strong TypeScript support with end-to-end type safety
- Loaders for data fetching and preparing menu state
- Message text updates when navigating between menus
- Per-menu internal state management
- Type-safe navigation between menus

## Warning

For production, prefer webhooks over long polling. With long polling, each user's menu interactions may be handled sequentially by your process.
Read more in the grammY docs: https://grammy.dev/guide/deployment-types

## Examples

### Basic menu

```ts
import { Bot, Context, session, SessionFlavor } from "grammy";
import { createMenu } from "@evgtools/better-grammy-menu";

type ExtendedContext = Context & SessionFlavor<Record<string, any>>;

// We need to pass a context type with SessionFlavor as a generic argument to Bot.
const bot = new Bot<ExtendedContext>("<YOUR_TOKEN>");

const mainMenu = createMenu({
  loader: () => {
    return {
      text: "This text will be <b>displayed</b> in telegram message",
      parseMode: "HTML",
    };
  },
  // layout is an inline keyboard
  layout: (builder) => {
    // simple button with "Click me" text
    builder.callback("Click me", () => {
      console.log("Hello world!");
    });
  },
});

bot.use(session({ initial: () => ({}) }), mainMenu.middleware);

bot.command("start", async (ctx) => {
  // sending menu
  await mainMenu.send(ctx);
});
```

When the user runs `/start`, the bot sends a message with the text `This text will be displayed in telegram message` and one button `Click me`.
When the user presses the button, the bot prints `Hello world!` to the console.

### Navigation to another menu

```ts
type ExtendedContext = Context & SessionFlavor<Record<string, any>>;

// We need to pass a context type with SessionFlavor as a generic argument to Bot.
const bot = new Bot<ExtendedContext>("<YOUR_TOKEN>");

const mainMenu = createMenu({
  loader: () => {
    return {
      text: "This text will be <b>displayed</b> in telegram message",
      parseMode: "HTML",
    };
  },
  // layout is an inline keyboard
  layout: (builder) => {
    // simple button with "Click me" text
    builder.callback("Click me", () => {
      console.log("Hello world!");
    });

    // make a new line
    builder.row();

    builder.callback("Navigate to other menu", async (ctx) => {
      // We pass the menu and its loader params as the second argument.
      // In this case, the type for the second argument is inferred automatically.
      // If we do not pass it, TypeScript will raise an error.
      await ctx.menu.navigate(otherMenu, { someText: "foo" });
    });
  },
});

type OtherMenuLoaderParams = {
  someText: string;
};

const otherMenu = createMenu({
  loader: (ctx, params: OtherMenuLoaderParams) => {
    const foobar = params.someText + "bar";

    // data will be passed into builder.callback and builder.dynamic (see below)
    return { text: `Passed params ${JSON.stringify(params)}`, data: foobar };
  },
  layout: (builder) => {
    // data is strongly typed, so we already know its type
    builder.callback("Whats inside?", (ctx, data) => {
      // will print "foobar"
      console.log(data);
    });
  },
});

bot.use(
  session({ initial: () => ({}) }),
  mainMenu.middleware,
  otherMenu.middleware, // register second menu
);

bot.command("start", async (ctx) => {
  // sending menu
  await mainMenu.send(ctx);
});
```

When you send or navigate to a menu, the flow is:

- `loader` runs to completion
- `layout` runs and builds the keyboard
- If you call `.send(ctx)`, the menu sends a new message
- If you call `ctx.menu.navigate(menu, menuArgs)`, the menu edits the existing message

### Passing data from `loader` into callbacks

`loader` can pass data into `builder.callback` using the `data` field in the return object.
This is useful for loading data once and reusing it in handlers.

```ts
const fetchUsers = async () => {
  return [
    { id: 1, name: "Thomas" },
    { id: 2, name: "John" },
  ];
};

const mainMenu = createMenu({
  loader: async (ctx) => {
    const users = await fetchUsers();

    return { text: `Users amount: ${users.length}`, data: users };
  },
  layout: (builder) => {
    builder.callback("Log users", (ctx, data) => {
      // Will print
      // [
      //   { id: 1, name: "Thomas" },
      //   { id: 2, name: "John" },
      // ]
      console.log(data);
    });
  },
});
```

### Dynamic layout with `dynamic`

If you need access to `data` while building the layout, use `dynamic`.

```ts
const mainMenu = createMenu({
  loader: async (ctx) => {
    const users = await fetchUsers();

    return { text: `Users amount: ${users.length}`, data: users };
  },
  layout: (builder) => {
    // will create:
    // [Thomas][John]
    builder.dynamic((ctx, builder, data) => {
      for (const { id, name } of data) {
        builder.callback(name, () => console.log(`User id: ${id}`));
      }
    });
  },
});
```

Use `dynamic` only when you need it. For each user, the library generates a dedicated set of callbacks.
This can increase RAM usage.

### Menu state

This example shows how to keep and update internal menu state.

```ts
type MainMenuLoaderParams = { resetCount: boolean };

const mainMenu = createMenu({
  state: () => ({ count: 0 }), // will be called one time when menu first time called
  loader: async (ctx, params?: MainMenuLoaderParams) => {
    if (params?.resetCount) {
      await ctx.menu.state.reset(); // reset will call state function to reset state
    }

    return {
      text: `Current count: ${ctx.menu.state.get("count")}`, // using state to display text
    };
  },
  layout: (builder) => {
    builder.callback("Increase count", async (ctx) => {
      ctx.menu.state.set("count", ctx.menu.state.get("count") + 1);
      await ctx.menu.refresh(); // refresh will rerender menu (loader call and layout build)
    });
    builder.callback("Decrease count", async (ctx) => {
      ctx.menu.state.set("count", (prev) => prev - 1); // same as ctx.menu.state.set("count", ctx.menu.state.get("count") - 1);

      if (ctx.menu.state.get("count") < 0) {
        // YES we can rerender menu with Partial<LoaderParams> passed
        await ctx.menu.refresh({ resetCount: true });
      } else {
        await ctx.menu.refresh();
      }
    });
  },
});
```

This menu starts with `Current count: 0` and two buttons, `Increase count` and `Decrease count`.
Each click updates the counter and refreshes the menu.
If the counter becomes negative, `Decrease count` refreshes the menu with `{ resetCount: true }`, which resets the counter in the loader.

Note: when you navigate to other menus, the state does not reset automatically. It persists until you reset it.

### Auto-reset state on enter with `onEnter`

If you want the state to reset every time you send or navigate to the menu, use `onEnter`.

```ts
const mainMenu = createMenu({
  state: () => ({ count: 0 }),
  onEnter: async (ctx) => {
    await ctx.menu.state.reset();
  },
  loader: async (ctx) => ({
    text: `Current count: ${ctx.menu.state.get("count")}`,
  }),
  layout: (builder) => {
    builder.callback("Increase count", async (ctx) => {
      ctx.menu.state.set("count", (prev) => prev + 1);
      await ctx.menu.refresh();
    });
    builder.callback("Decrease count", async (ctx) => {
      ctx.menu.state.set("count", (prev) => prev - 1);
      await ctx.menu.refresh();
    });
  },
});
```

## Notes and limitations

- Only one menu can be active at a time. You cannot have two active menus at once.
  If a new menu is sent, interactions with the old one will show `options.staleErrorText`.
  You can customize it with `createMenu({ options: { staleErrorText: "" } })`.
- Each handler has a maximum execution time. If a `callback` runs longer than `options.timeoutMs` (default `10_000`), the user will see `options.timeoutErrorText`.
  This prevents menus from hanging forever on unhandled timeouts, for example during a `fetch` call.
  Setting this value above `20_000` is not recommended.
- The library infers most types automatically, but it cannot infer your custom context type.
  You have two options.

### Option 1: Pass generics to `createMenu` (not recommended)

```ts
import { createMenu } from "@evgtools/better-grammy-menu";

createMenu<ContextType, StateType, LoaderArgumentsType, LoaderDataType>({ ... })
```

### Option 2: Use a factory (recommended)

```ts
import { createMenuFactory } from "@evgtools/better-grammy-menu";

const createMenu = createMenuFactory<ContextType>({ staleErrorText: ... }); // you can pass default options for every menu

const menu = createMenu({ ... }); // will use ContextType from createMenuFactory
```
