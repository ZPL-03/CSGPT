import Fuse from "fuse.js";
import { nanoid } from "nanoid";
import { StoreKey } from "../constant";
import { getLang } from "../locales";
import { createPersistStore } from "../utils/store";

export interface Prompt {
  id: string;
  isUser?: boolean;
  title: string;
  content: string;
  createdAt: number;
}

const STORE_SCHEMA_VERSION = 1;
const DEFAULT_PROMPT_STATE = {
  counter: 0,
  prompts: {} as Record<string, Prompt>,
};

function normalizePromptState(
  state?: Partial<typeof DEFAULT_PROMPT_STATE>,
): typeof DEFAULT_PROMPT_STATE {
  const source = JSON.parse(JSON.stringify(state || {})) as Partial<
    typeof DEFAULT_PROMPT_STATE
  >;
  const prompts: Record<string, Prompt> = {};

  Object.values(source.prompts || {}).forEach((prompt) => {
    const id = prompt.id || nanoid();
    prompts[id] = {
      ...prompt,
      id,
      createdAt: prompt.createdAt || Date.now(),
    } as Prompt;
  });

  return {
    ...DEFAULT_PROMPT_STATE,
    ...source,
    counter: Number(source.counter) || 0,
    prompts,
  };
}

export const SearchService = {
  ready: false,
  builtinEngine: new Fuse<Prompt>([], { keys: ["title"] }),
  userEngine: new Fuse<Prompt>([], { keys: ["title"] }),
  count: {
    builtin: 0,
  },
  allPrompts: [] as Prompt[],
  builtinPrompts: [] as Prompt[],

  init(builtinPrompts: Prompt[], userPrompts: Prompt[]) {
    if (this.ready) {
      return;
    }
    this.allPrompts = userPrompts.concat(builtinPrompts);
    this.builtinPrompts = builtinPrompts.slice();
    this.builtinEngine.setCollection(builtinPrompts);
    this.userEngine.setCollection(userPrompts);
    this.ready = true;
  },

  remove(id: string) {
    this.userEngine.remove((doc) => doc.id === id);
  },

  add(prompt: Prompt) {
    this.userEngine.add(prompt);
  },

  search(text: string) {
    const userResults = this.userEngine.search(text);
    const builtinResults = this.builtinEngine.search(text);
    return userResults.concat(builtinResults).map((v) => v.item);
  },
};

export const usePromptStore = createPersistStore(
  { ...DEFAULT_PROMPT_STATE },

  (set, get) => ({
    add(prompt: Prompt) {
      const prompts = get().prompts;
      prompt.id = nanoid();
      prompt.isUser = true;
      prompt.createdAt = Date.now();
      prompts[prompt.id] = prompt;

      set(() => ({
        prompts: prompts,
      }));

      return prompt.id!;
    },

    get(id: string) {
      const targetPrompt = get().prompts[id];

      if (!targetPrompt) {
        return SearchService.builtinPrompts.find((v) => v.id === id);
      }

      return targetPrompt;
    },

    remove(id: string) {
      const prompts = get().prompts;
      delete prompts[id];

      Object.entries(prompts).some(([key, prompt]) => {
        if (prompt.id === id) {
          delete prompts[key];
          return true;
        }
        return false;
      });

      SearchService.remove(id);

      set(() => ({
        prompts,
        counter: get().counter + 1,
      }));
    },

    getUserPrompts() {
      const userPrompts = Object.values(get().prompts ?? {});
      userPrompts.sort((a, b) =>
        b.id && a.id ? b.createdAt - a.createdAt : 0,
      );
      return userPrompts;
    },

    updatePrompt(id: string, updater: (prompt: Prompt) => void) {
      const prompt = get().prompts[id] ?? {
        title: "",
        content: "",
        id,
      };

      SearchService.remove(id);
      updater(prompt);
      const prompts = get().prompts;
      prompts[id] = prompt;
      set(() => ({ prompts }));
      SearchService.add(prompt);
    },

    search(text: string) {
      if (text.length === 0) {
        // 返回全部提示词
        return this.getUserPrompts().concat(SearchService.builtinPrompts);
      }
      return SearchService.search(text) as Prompt[];
    },
  }),
  {
    name: StoreKey.Prompt,
    version: STORE_SCHEMA_VERSION,

    migrate(state) {
      return normalizePromptState(
        state as Partial<typeof DEFAULT_PROMPT_STATE>,
      ) as any;
    },

    onRehydrateStorage(state) {
      // 服务端跳过 store 水合
      if (typeof window === "undefined") {
        return;
      }

      const PROMPT_URL = "./prompts.json";

      type PromptList = Array<[string, string]>;

      fetch(PROMPT_URL)
        .then((res) => res.json())
        .then((res) => {
          // 仅加载当前语言的提示词模板
          const promptList: PromptList = getLang() === "cn" ? res.cn : res.en;
          const builtinPrompts = [
            promptList.map(
              ([title, content]) =>
                ({
                  id: nanoid(),
                  title,
                  content,
                  createdAt: Date.now(),
                }) as Prompt,
            ),
          ];

          const userPrompts = usePromptStore.getState().getUserPrompts() ?? [];

          const allPromptsForSearch = builtinPrompts
            .reduce((pre: Prompt[], cur: Prompt[]) => pre.concat(cur), [])
            .filter((v: Prompt) => !!v.title && !!v.content);
          SearchService.count.builtin = promptList.length;
          SearchService.init(allPromptsForSearch, userPrompts);
        });
    },
  },
);
