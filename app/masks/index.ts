import { Mask } from "../store/mask";
import { getLang } from "../locales";

import { type BuiltinMask } from "./typing";
export { type BuiltinMask } from "./typing";

// 导入 CSGPT 中英文 Mask
import { CSGPT_MASKS } from "./csgpt";
import { CSGPT_MASKS_EN } from "./csgpt-en";

export const BUILTIN_MASK_ID = 100000;

export const BUILTIN_MASK_STORE = {
  buildinId: BUILTIN_MASK_ID,
  masks: {} as Record<string, BuiltinMask>,
  get(id?: string) {
    if (!id) return undefined;
    return this.masks[id] as Mask | undefined;
  },
  add(m: BuiltinMask) {
    const mask = { ...m, id: this.buildinId++, builtin: true };
    this.masks[mask.id] = mask;
    return mask;
  },
};

export const BUILTIN_MASKS: BuiltinMask[] = [];

// 根据当前语言加载对应的 Mask
const lang = getLang();
const masksForLang = lang === "en" ? CSGPT_MASKS_EN : CSGPT_MASKS;
masksForLang.forEach((mask) => {
  BUILTIN_MASKS.push(BUILTIN_MASK_STORE.add(mask));
});

if (typeof window != "undefined") {
  fetch("/masks.json")
    .then((res) => res.json())
    .catch((error) => {
      console.error("[Fetch] failed to fetch masks", error);
      return {};
    })
    .then((masks) => {
      // 兼容 csgpt / cn / en 多种 key
      const extra = [
        ...(masks.csgpt || []),
        ...(masks.cn || []),
        ...(masks.en || []),
      ];
      extra.forEach((m: BuiltinMask) => {
        BUILTIN_MASKS.push(BUILTIN_MASK_STORE.add(m));
      });
    });
}
