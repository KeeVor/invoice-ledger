import type { ReleaseNote, ReleaseNotesHistory } from "./types";

const versionPattern = /^(\d+)\.(\d+)\.(\d+)$/;

export function releaseNotesText(notes: string) {
  if (!/<[a-z][^>]*>/i.test(notes)) return notes.trim();
  const document = new DOMParser().parseFromString(notes, "text/html");
  for (const element of Array.from(
    document.querySelectorAll("script,style,img,svg,object,iframe"),
  ))
    element.remove();
  for (const br of Array.from(document.querySelectorAll("br")))
    br.replaceWith(document.createTextNode("\n"));
  for (const item of Array.from(document.querySelectorAll("li")))
    item.prepend(document.createTextNode("• "));
  for (const block of Array.from(
    document.querySelectorAll("h1,h2,h3,h4,h5,h6,p,li,tr,div"),
  ))
    block.append(document.createTextNode("\n"));
  return (document.body.textContent ?? notes)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function versionParts(version: string) {
  const match = versionPattern.exec(version.replace(/^v/, ""));
  return match ? match.slice(1).map(Number) : null;
}

export function compareVersions(left: string, right: string) {
  const a = versionParts(left);
  const b = versionParts(right);
  if (!a || !b) return 0;
  for (let index = 0; index < 3; index++) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
}

export function releaseNotesForUpdate(
  history: ReleaseNotesHistory | undefined,
  currentVersion: string,
  latestVersion: string,
): ReleaseNote[] {
  if (!history) return [];
  return history.releases
    .filter(
      (release) =>
        versionParts(release.version) &&
        compareVersions(release.version, currentVersion) > 0 &&
        compareVersions(release.version, latestVersion) <= 0,
    )
    .sort((a, b) => compareVersions(b.version, a.version));
}
