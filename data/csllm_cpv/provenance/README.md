# 外部 RAG/KG 数据追溯

本目录记录 `data/csllm_cpv` 中外部 RAG/KG 数据包的文件清单、记录数量、字节大小和 SHA256 哈希。

运行时只读取本项目内部的 `data/csllm_cpv` 数据，不依赖其他项目目录。`manifest.json` 用于整体数据包追溯，`file_manifest.jsonl` 用于逐文件校验。
