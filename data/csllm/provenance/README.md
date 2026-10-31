# CSGPT 运行数据包

`runtime/rag_chunks.compact.jsonl.gz` 保存 RAG 检索文本块。
`runtime/relations.compact.jsonl.gz` 保存知识图谱关系及其证据来源。
`kg/entities.jsonl` 和 `kg/kg_stats.json` 保存知识图谱实体与统计信息。
`provenance/manifest.json` 和 `provenance/file_manifest.jsonl` 保存记录数、字节数和 SHA256。

运行包面向 Web 服务端的文本检索和知识图谱读取，不包含离线向量矩阵、SQLite 检索索引或评测文件。
