#!/usr/bin/env python3
from __future__ import annotations

import json
import re
import shutil
from dataclasses import dataclass, field
from hashlib import sha256
from pathlib import Path


MANAGED_HEADER = "<!-- Managed by generalize-claude-setup. Edit the canonical source instead. -->\n\n"


@dataclass(slots=True)
class Skill:
    source_dir: Path
    canonical_name: str
    command_name: str
    description: str
    markdown_body: str
    raw_skill_text: str
    support_files: list[Path] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


def main() -> int:
    repo_root = Path(__file__).resolve().parents[1]
    skills = discover_skills(repo_root)
    root_instructions = strip_generated_skill_index((repo_root / "AGENTS.md").read_text(encoding="utf-8"))
    canonical_agents = render_agents_md(root_instructions, skills)
    writes = {
        "AGENTS.md": canonical_agents,
        "CLAUDE.md": MANAGED_HEADER + canonical_agents,
        "GEMINI.md": render_gemini_memory(canonical_agents),
    }
    copies: dict[str, Path] = {}
    warnings: list[str] = []

    for skill in skills:
        warnings.extend(skill.warnings)
        writes[f".claude/skills/{skill.canonical_name}/SKILL.md"] = MANAGED_HEADER + canonical_skill_copy_note(skill)
        writes[f".gemini/commands/{skill.command_name}.toml"] = render_gemini_command(skill)
        for support_file in skill.support_files:
            relative = support_file.relative_to(skill.source_dir).as_posix()
            copies[f".claude/skills/{skill.canonical_name}/{relative}"] = support_file

    writes[".agent-harness/manifest.json"] = render_manifest(repo_root, skills, writes, copies, warnings)
    remove_stale_managed_paths(repo_root, set(writes), set(copies))

    for relative, source in copies.items():
        destination = repo_root / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, destination)
    for relative, content in writes.items():
        path = repo_root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")

    print(json.dumps({"updated_files": sorted(writes), "updated_copies": sorted(copies)}, indent=2))
    return 0


def discover_skills(repo_root: Path) -> list[Skill]:
    skills_root = repo_root / ".agent-harness" / "skills"
    skills: list[Skill] = []
    if not skills_root.exists():
        return skills
    for skill_md in sorted(skills_root.rglob("SKILL.md")):
        skill_dir = skill_md.parent
        raw_skill_text = skill_md.read_text(encoding="utf-8").strip() + "\n"
        frontmatter, body = split_frontmatter(raw_skill_text)
        relative_source_dir = skill_dir.relative_to(skills_root)
        canonical_name = sanitize_name(relative_source_dir.as_posix().replace("/", "-"))
        command_name = sanitize_name(frontmatter.get("name", skill_dir.name))
        description = frontmatter.get("description") or infer_description(body)
        support_files = detect_support_files(skill_dir)
        warnings = []
        if support_files:
            warnings.append(
                f"Skill '{command_name}' includes supporting files that are preserved structurally but not semantically translated."
            )
        skills.append(
            Skill(
                source_dir=skill_dir,
                canonical_name=canonical_name,
                command_name=command_name,
                description=description,
                markdown_body=body.strip() + ("\n" if body.strip() else ""),
                raw_skill_text=raw_skill_text,
                support_files=support_files,
                warnings=warnings,
            )
        )
    return skills


def remove_stale_managed_paths(repo_root: Path, current_writes: set[str], current_copies: set[str]) -> None:
    manifest_path = repo_root / ".agent-harness" / "manifest.json"
    if not manifest_path.exists():
        return
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    keep = current_writes | current_copies | {"AGENTS.md", ".agent-harness/update-managed-files.py"}
    previous = set(manifest.get("owned_files", [])) | set(manifest.get("owned_copies", []))
    for relative in sorted(previous - keep, reverse=True):
        path = repo_root / relative
        if not path.exists() or not is_safe_generated_path(relative):
            continue
        if path.is_dir():
            shutil.rmtree(path)
        else:
            path.unlink()
        prune_empty_parents(path.parent, repo_root)


def is_safe_generated_path(relative: str) -> bool:
    return (
        relative in {"CLAUDE.md", "GEMINI.md", ".agent-harness/manifest.json"}
        or relative.startswith(".claude/skills/")
        or relative.startswith(".gemini/commands/")
    )


def prune_empty_parents(path: Path, repo_root: Path) -> None:
    stop_dirs = {repo_root, repo_root / ".claude", repo_root / ".claude" / "skills", repo_root / ".gemini", repo_root / ".gemini" / "commands"}
    while path not in stop_dirs and path.exists():
        try:
            path.rmdir()
        except OSError:
            return
        path = path.parent


def canonical_skill_copy_note(skill: Skill) -> str:
    support_note = ""
    if skill.support_files:
        support_list = "\n".join(
            f"- `.agent-harness/skills/{skill.canonical_name}/{path.relative_to(skill.source_dir).as_posix()}`"
            for path in skill.support_files
        )
        support_note = f"\n## Supporting Files\n\n{support_list}\n"
    return (
        f"Canonical source: `.agent-harness/skills/{skill.canonical_name}/SKILL.md`\n\n"
        f"{skill.raw_skill_text.rstrip()}\n"
        f"{support_note}"
    )


def render_gemini_memory(canonical_agents: str) -> str:
    return (
        "<!-- Managed by generalize-claude-setup. Edit AGENTS.md and canonical skills instead. -->\n\n"
        f"{canonical_agents.rstrip()}\n\n"
        "## Gemini Commands\n\n"
        "Project skills are exposed as Gemini custom commands under `.gemini/commands/`.\n"
    )


def render_agents_md(root_instructions: str, skills: list[Skill]) -> str:
    sections = []
    if root_instructions:
        sections.append(root_instructions.rstrip())
    sections.append(render_skill_index(skills).rstrip())
    return "\n\n".join(section for section in sections if section).strip() + "\n"


def render_skill_index(skills: list[Skill]) -> str:
    lines = ["## Project Skills", ""]
    if not skills:
        lines.append("No project-local skills were discovered.")
        return "\n".join(lines) + "\n"
    for skill in skills:
        canonical_path = f".agent-harness/skills/{skill.canonical_name}/SKILL.md"
        lines.append(f"- `{skill.command_name}`: {skill.description} Canonical source: `{canonical_path}`.")
    return "\n".join(lines) + "\n"


def render_gemini_command(skill: Skill) -> str:
    prompt_parts = [
        f"Follow the project skill `{skill.command_name}` using the canonical source at `.agent-harness/skills/{skill.canonical_name}/SKILL.md`."
    ]
    if skill.support_files:
        prompt_parts.append("Supporting files are available at:")
        prompt_parts.extend(
            f"- `.agent-harness/skills/{skill.canonical_name}/{path.relative_to(skill.source_dir).as_posix()}`"
            for path in skill.support_files
        )
    if skill.markdown_body:
        prompt_parts.append("")
        prompt_parts.append(skill.markdown_body.rstrip())
    prompt = "\n".join(prompt_parts).rstrip()
    escaped_description = skill.description.replace('"', '\\"')
    escaped_prompt = prompt.replace('"""', '\\"\\"\\"')
    return f'description = "{escaped_description}"\nprompt = """\n{escaped_prompt}\n"""\n'


def render_manifest(
    repo_root: Path,
    skills: list[Skill],
    writes: dict[str, str],
    copies: dict[str, Path],
    warnings: list[str],
) -> str:
    owned_files = set(writes)
    owned_files.update({"AGENTS.md", ".agent-harness/update-managed-files.py"})
    canonical_copies = {
        f".agent-harness/skills/{path.relative_to(repo_root / '.agent-harness' / 'skills').as_posix()}"
        for skill in skills
        for path in [skill.source_dir / "SKILL.md", *skill.support_files]
    }
    data = {
        "generator": {"name": "generalize-claude-setup", "version": "0.1.0"},
        "repo_root": str(repo_root),
        "owned_files": sorted(owned_files),
        "owned_copies": sorted(set(copies) | canonical_copies),
        "source_hashes": {
            "CLAUDE.md": digest_text(strip_generated_skill_index(writes["AGENTS.md"])),
            "skills": {skill.command_name: digest_text(skill.raw_skill_text) for skill in skills},
        },
        "warnings": warnings,
    }
    return json.dumps(data, indent=2) + "\n"


FRONTMATTER_RE = re.compile(r"\A---\r?\n(.*?)\r?\n---\r?\n?(.*)\Z", re.DOTALL)
KEY_VALUE_RE = re.compile(r"^([A-Za-z0-9_-]+):\s*(.*)$")


def split_frontmatter(text: str) -> tuple[dict[str, str], str]:
    match = FRONTMATTER_RE.match(text)
    if not match:
        return {}, text
    raw_frontmatter, body = match.groups()
    data: dict[str, str] = {}
    for line in raw_frontmatter.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        key_match = KEY_VALUE_RE.match(line)
        if not key_match:
            continue
        key, value = key_match.groups()
        data[key] = value.strip().strip("'").strip('"')
    return data, body.lstrip("\r\n")


def infer_description(body: str) -> str:
    for line in body.splitlines():
        stripped = line.strip()
        if stripped and not stripped.startswith("#"):
            return stripped[:160]
    return "Reusable project skill."


def sanitize_name(raw: str) -> str:
    lowered = raw.strip().lower()
    lowered = re.sub(r"[^a-z0-9]+", "-", lowered)
    lowered = re.sub(r"-{2,}", "-", lowered).strip("-")
    return lowered or "skill"


def detect_support_files(skill_dir: Path) -> list[Path]:
    files: list[Path] = []
    for path in sorted(skill_dir.rglob("*")):
        if path.is_file() and path.name != "SKILL.md":
            files.append(path)
    return files


def strip_generated_skill_index(text: str) -> str:
    marker = "\n## Project Skills\n"
    if marker not in text:
        return text.strip() + ("\n" if text.strip() else "")
    prefix, _, _ = text.partition(marker)
    return prefix.strip() + ("\n" if prefix.strip() else "")


def digest_text(text: str) -> str:
    return sha256(text.encode("utf-8")).hexdigest()


if __name__ == "__main__":
    raise SystemExit(main())
