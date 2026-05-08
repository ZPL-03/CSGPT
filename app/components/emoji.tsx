import EmojiPicker, {
  Emoji,
  EmojiStyle,
  Theme as EmojiTheme,
} from "emoji-picker-react";

import { ModelType } from "../store";
import { ServiceProvider } from "../constant";

import BotIconDefault from "../icons/llm-icons/default.svg";
import BotIconOpenAI from "../icons/llm-icons/openai.svg";
import BotIconGemini from "../icons/llm-icons/gemini.svg";
import BotIconGemma from "../icons/llm-icons/gemma.svg";
import BotIconClaude from "../icons/llm-icons/claude.svg";
import BotIconMeta from "../icons/llm-icons/meta.svg";
import BotIconMistral from "../icons/llm-icons/mistral.svg";
import BotIconDeepseek from "../icons/llm-icons/deepseek.svg";
import BotIconMoonshot from "../icons/llm-icons/moonshot.svg";
import BotIconQwen from "../icons/llm-icons/qwen.svg";
import BotIconWenxin from "../icons/llm-icons/wenxin.svg";
import BotIconGrok from "../icons/llm-icons/grok.svg";
import BotIconHunyuan from "../icons/llm-icons/hunyuan.svg";
import BotIconDoubao from "../icons/llm-icons/doubao.svg";
import BotIconChatglm from "../icons/llm-icons/chatglm.svg";
import BotIconIflytek from "../icons/llm-icons/iflytek.svg";
import BotIconSiliconflow from "../icons/llm-icons/siliconflow.svg";
import BotIconAzure from "../icons/llm-icons/azure.svg";
import BotIconAI302 from "../icons/llm-icons/ai302.svg";

export function getEmojiUrl(unified: string, style: EmojiStyle) {
  // Whoever owns this Content Delivery Network (CDN), I am using your CDN to serve emojis
  // Old CDN broken, so I had to switch to this one
  // Author: https://github.com/H0llyW00dzZ
  return `https://fastly.jsdelivr.net/npm/emoji-datasource-apple/img/${style}/64/${unified}.png`;
}

export function AvatarPicker(props: {
  onEmojiClick: (emojiId: string) => void;
}) {
  return (
    <EmojiPicker
      width={"100%"}
      lazyLoadEmojis
      theme={EmojiTheme.AUTO}
      getEmojiUrl={getEmojiUrl}
      onEmojiClick={(e) => {
        props.onEmojiClick(e.unified);
      }}
    />
  );
}

export function Avatar(props: {
  model?: ModelType | string;
  providerName?: ServiceProvider | string;
  avatar?: string;
}) {
  let LlmIcon = BotIconDefault;

  if (props.model) {
    const modelName = props.model.toLowerCase();
    const providerName = props.providerName?.toLowerCase();

    // 优先根据提供商匹配图标
    if (providerName === ServiceProvider.Iflytek.toLowerCase()) {
      LlmIcon = BotIconIflytek;
    } else if (providerName === ServiceProvider.SiliconFlow.toLowerCase()) {
      LlmIcon = BotIconSiliconflow;
    } else if (providerName === ServiceProvider.Azure.toLowerCase()) {
      LlmIcon = BotIconAzure;
    } else if (providerName === ServiceProvider["302.AI"].toLowerCase()) {
      LlmIcon = BotIconAI302;
    } else if (
      providerName === ServiceProvider.Moonshot.toLowerCase() ||
      modelName.startsWith("kimi")
    ) {
      LlmIcon = BotIconMoonshot;
    } else if (
      providerName === ServiceProvider.CSGPT.toLowerCase() ||
      modelName.startsWith("qwen")
    ) {
      LlmIcon = BotIconQwen;
    } else if (modelName.startsWith("moonshot")) {
      LlmIcon = BotIconMoonshot;
    } else if (
      modelName.startsWith("gpt") ||
      modelName.startsWith("chatgpt") ||
      modelName.startsWith("dall-e") ||
      modelName.startsWith("dalle") ||
      modelName.startsWith("o1") ||
      modelName.startsWith("o3")
    ) {
      LlmIcon = BotIconOpenAI;
    } else if (modelName.startsWith("gemini")) {
      LlmIcon = BotIconGemini;
    } else if (modelName.startsWith("gemma")) {
      LlmIcon = BotIconGemma;
    } else if (modelName.startsWith("claude")) {
      LlmIcon = BotIconClaude;
    } else if (modelName.includes("llama")) {
      LlmIcon = BotIconMeta;
    } else if (
      modelName.startsWith("mixtral") ||
      modelName.startsWith("codestral")
    ) {
      LlmIcon = BotIconMistral;
    } else if (modelName.includes("deepseek")) {
      LlmIcon = BotIconDeepseek;
    } else if (modelName.startsWith("qwen")) {
      LlmIcon = BotIconQwen;
    } else if (modelName.startsWith("ernie")) {
      LlmIcon = BotIconWenxin;
    } else if (modelName.startsWith("grok")) {
      LlmIcon = BotIconGrok;
    } else if (modelName.startsWith("hunyuan")) {
      LlmIcon = BotIconHunyuan;
    } else if (modelName.startsWith("doubao") || modelName.startsWith("ep-")) {
      LlmIcon = BotIconDoubao;
    } else if (
      modelName.includes("glm") ||
      modelName.startsWith("cogview-") ||
      modelName.startsWith("cogvideox-")
    ) {
      LlmIcon = BotIconChatglm;
    }

    return (
      <div className="no-dark">
        <LlmIcon className="user-avatar" width={30} height={30} />
      </div>
    );
  }

  return (
    <div className="user-avatar">
      {props.avatar && <EmojiAvatar avatar={props.avatar} />}
    </div>
  );
}

export function EmojiAvatar(props: { avatar: string; size?: number }) {
  return (
    <Emoji
      unified={props.avatar}
      size={props.size ?? 18}
      getEmojiUrl={getEmojiUrl}
    />
  );
}
