import type { EntryMeta, Identity } from '../types.js';

/** 可见性(M08/M04 共用):访客=仅 studio;agent=本 agent+本 member+studio;member 凭证=本 member 全部+studio */
export function visibleTo(identity: Identity | null, m: EntryMeta): boolean {
  if (!identity) return m.scope === 'studio';
  if (m.scope === 'studio') return true;
  if (m.owner.member !== identity.member) return false;
  if (m.scope === 'member') return true;
  if (!identity.agent_label) return true;
  return m.owner.agent === identity.agent_label;
}
