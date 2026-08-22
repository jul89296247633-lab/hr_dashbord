type PhotoMatchRow = {
  full_name?: string | null;
  city?: string | null;
  photo_path?: string | null;
};

type PhotoCandidate = PhotoMatchRow & {
  id?: string | number | null;
};

function norm(value: unknown): string {
  return String(value || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^a-zа-я0-9]+/gi, " ")
    .trim();
}

function nameParts(value: unknown): string[] {
  return Array.from(new Set(norm(value).split(/\s+/).filter(Boolean))).sort();
}

function namesCompatible(left: unknown, right: unknown): boolean {
  const a = nameParts(left);
  const b = nameParts(right);
  if (a.length < 2 || b.length < 2) return false;
  if (a.length === b.length) return a.every(function (part, i) { return part === b[i]; });

  const shorter = a.length < b.length ? a : b;
  const longer = a.length < b.length ? b : a;
  return longer.length - shorter.length === 1 && shorter.every(function (part) { return longer.includes(part); });
}

function citiesCompatible(left: unknown, right: unknown): boolean {
  const a = norm(left);
  const b = norm(right);
  return !a || !b || a === b;
}

export function findUniquePhotoMatch(row: PhotoMatchRow | null | undefined, people: PhotoCandidate[] | null | undefined): PhotoCandidate | null {
  const matches = (people || []).filter(function (person) {
    return person && person.photo_path &&
      namesCompatible(row && row.full_name, person.full_name) &&
      citiesCompatible(row && row.city, person.city);
  });
  return matches.length === 1 ? matches[0] : null;
}
