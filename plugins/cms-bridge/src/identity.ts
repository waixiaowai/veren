/**
 * 节点身份：随连接上报给 cms、可在 Web UI 修改的身份事实。
 * The node identity: the identity facts reported to cms on connect and
 * editable in the Web UI.
 */

/** 身份上报事件名 / the identity report event name */
export const IDENTITY_EVENT = 'node.identity';

/** 节点身份 / the node identity */
export interface NodeIdentity {
  /** 稳定 uuid；首次启动自动生成 / stable uuid; auto-generated on first boot */
  nodeId: string;
  nodeName: string;
  nodeDescription: string;
  /** 图标：emoji、短字符或图片 URL / icon: an emoji, a short glyph or an image URL */
  nodeIcon: string;
}
