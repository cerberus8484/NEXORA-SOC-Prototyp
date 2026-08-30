// Reine Filtier- und Paginierungs-Logik für die Benutzer-Tabelle.
// Kein React, kein State — vollständig testbar.

import type { ManagedUser } from './userMgmtModel';

export interface UserFilter {
  search: string;
  role: string; // leerer String = alle Rollen
}

export interface PaginationResult<T> {
  items: T[];
  totalCount: number;
  totalPages: number;
  /** 1-basierter erster Index der aktuellen Seite (für „Zeige X bis Y von N"). */
  fromIndex: number;
  /** 1-basierter letzter Index der aktuellen Seite. */
  toIndex: number;
}

/**
 * Filtert Benutzer nach Suchbegriff (E-Mail + displayName, case-insensitiv)
 * und optionalem Rollen-Filter.
 * Gibt immer ein neues Array zurück (immutabel).
 */
export function filterUsers(users: ManagedUser[], filter: UserFilter): ManagedUser[] {
  const term = filter.search.trim().toLowerCase();
  const role = filter.role.trim();

  return users.filter((u) => {
    const matchesSearch =
      term === '' ||
      u.email.toLowerCase().includes(term) ||
      (u.displayName ?? '').toLowerCase().includes(term);

    const matchesRole = role === '' || u.role === role;

    return matchesSearch && matchesRole;
  });
}

/**
 * Teilt eine (bereits gefilterte) Liste in Seiten auf.
 * `page` ist 1-basiert. Bei einer leeren Liste wird totalPages = 0.
 * Bei einem page-Index außerhalb → leere items, kein Crash.
 */
export function paginateUsers<T>(
  items: T[],
  page: number,
  pageSize: number,
): PaginationResult<T> {
  const totalCount = items.length;
  const totalPages = totalCount === 0 ? 0 : Math.ceil(totalCount / pageSize);

  const startIndex = (page - 1) * pageSize;
  const sliced = items.slice(startIndex, startIndex + pageSize);

  const fromIndex = totalCount === 0 ? 0 : startIndex + 1;
  const toIndex   = startIndex + sliced.length;

  return { items: sliced, totalCount, totalPages, fromIndex, toIndex };
}
