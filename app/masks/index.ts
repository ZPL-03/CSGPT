import { Mask } from "../store/mask";

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

// 加载中英文所有预设面具，按名称去重
const allMasks = [...CSGPT_MASKS, ...CSGPT_MASKS_EN];
allMasks.forEach((mask) => {
  BUILTIN_MASKS.push(BUILTIN_MASK_STORE.add(mask));
});
