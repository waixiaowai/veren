# Page Registryï¼ˆé¡µé¢æ³¨å†Œè¡¨æœåŠ¡ï¼‰

[English](./README.md) | ä¸­æ–‡

## æ˜¯ä»€ä¹ˆ / ä½•æ—¶ç”¨

å®¿ä¸»çº§ **Service æ’ä»¶**ï¼ŒæŒæœ‰ LLM é¡µé¢ä¼šè¯çš„é¡µé¢æ³¨å†Œè¡¨â€”â€”èƒ½åŠ›æ¥ç¼ä¸­ `PageRegistryService` å¥‘çº¦çš„ Service Providerã€‚é¡µé¢æ’ä»¶éœ€è¦æŠŠå£°æ˜å¼é¡µé¢ï¼ˆ`{ name, url, description }`ï¼ŒURL æ¨¡å¼å¦‚ `/task-detail/:taskId`ï¼‰æ³¨å†Œè¿›éƒ¨ç½²çº§å”¯ä¸€æ³¨å†Œè¡¨ã€å¯¼èˆªå…¥å£/ç›®å½•/æ¨¡å‹å·¥å…·éœ€è¦è§£æ URLï¼ˆè·¯å¾„å‚æ•° + queryï¼Œpath ä¼˜å…ˆï¼‰æ—¶ä½¿ç”¨ã€‚æ²¡æœ‰å£°æ˜å¼é¡µé¢å°±ä¸è¦è£…ã€‚

## ä¸‰è§’è‰²

- **Service Definition**ï¼ˆ`src/service.ts`ï¼‰ï¼š`register`ï¼ˆè¿”å› disposerï¼ŒHMR/å¸è½½å®‰å…¨ï¼‰/ `resolve<S>(url)` / `get<S>(name)` / `catalog()` / `format(pattern, params)`
- **Service Provider**ï¼ˆé»˜è®¤å¯¼å‡ºï¼‰ï¼šéƒ¨ç½²é¡¶å±‚æŒ‚è½½ä¸€æ¬¡ï¼›ä¼šè¯å­ä½œç”¨åŸŸç» `inject: ['pageRegistry']` è§£æåˆ°åŒä¸€å®ä¾‹
- **Consumer**ï¼šé¡µé¢æ’ä»¶ï¼ˆ`registry.register(page)`ï¼‰ã€å¯¼èˆªå·¥å…·ï¼ˆ`registry.resolve(url)` â†’ å…³æ—§ä¼šè¯ + mountï¼‰ã€ç›®å½•é¢æ¿ï¼ˆ`registry.catalog()`ï¼‰

## å¥‘çº¦

- é‡å / URL æ¨¡å¼å†²çªåœ¨æ³¨å†Œæ—¶æŠ›é”™ï¼ˆmisconfiguration fails loudï¼‰
- `resolve` æ— å‘½ä¸­è¿”å› `null`ï¼›åˆå¹¶å‚æ•°ä¸º `{ ...query, ...pathParams }`ï¼ˆpath ä¼˜å…ˆï¼‰
- å†…æ ¸ï¼ˆ`@veren/prompt-page`ï¼‰ä¿æŒ cordis æ— å…³ï¼›æœ¬æ’ä»¶æ˜¯æ³¨å†Œè¡¨ä¸å®¿ä¸»ç›¸æ¥çš„å”¯ä¸€ä½ç½®

## è¿è¡Œ

```bash
pnpm --filter @veren/page-registry test
```

## ÊµÀıË÷ÒıÓëÒ³ÃæÔËĞĞÊ±£¨µÚ 1 ½×¶Î£©

- `service.instances`£º³Ö¾Ã»¯ `PageInstanceIndex`£¨`app_pages` ´æ´¢Óò£»reserve/commit Á½½×¶Î£»ÖØÆôºóÈÔÃüÖĞ£»»á»°±»É¾×Ô¶¯Ê§Ğ§ÖØ½¨£©¡£
- `service.openUrl(url, { taskId })`£º¹æ·¶»¯ URL ¡ú Ğ£ÑéÓ¦ÓÃ ¡ú Ë÷ÒıÃüÖĞ¼´»Ö¸´¾Û½¹£¬Î´ÃüÖĞÔò reserve ¡ú ½¨»á»° ¡ú ¹Ò `<toolPrefix>__<±¾µØÃû>` ¹¤¾ß ¡ú Ğ´Ò»´Î PAGE ¿é ¡ú commit ¡ú ¾Û½¹£»ÈÎÎñ³¡¾°ÏÈ take ÔÙ×·¼Ó TASK ¿é¡£ÎÈ¶¨´íÎóÂë£ºapp/not-found¡¢app/disabled¡¢page/stale¡¢page/not-found¡¢task/expired¡¢page/session-create-failed¡¢page/tool-conflict¡¢page/index-unavailable¡£
- `registerAppPage(appId, page)`£ºÓ¦ÓÃ×÷ÓÃÓò×¢²á£¨Óë app-registry µÄ `ctx.apps.pages(id)` ¶Ô½Ó£©£»`page.<name>` Ô¤ÉèÂ·¾¶±£³Ö·ÏÆú¡£
- ËŞÖ÷¹¤¾ß `app_open` ¾­ `registerAppOpenTool` ×¢²á¡£

