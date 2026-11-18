import React from 'react';

// Exibe apenas Markdown seguro (sem HTML nem links automáticos).
// Evita dependências novas para não afetar o restante do TeleFluxo.
function inlineMarkdown(text: string): React.ReactNode[] {
  return text.split(/(\*\*[^*\n]+\*\*|`[^`\n]+`|\*[^*\n]+\*)/g).map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return <strong key={index} className="font-extrabold text-slate-900">{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      return <code key={index} className="rounded bg-slate-100 px-1.5 py-0.5 text-[0.9em] text-slate-800">{part.slice(1, -1)}</code>;
    }
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
      return <em key={index}>{part.slice(1, -1)}</em>;
    }
    return <React.Fragment key={index}>{part}</React.Fragment>;
  });
}

function isTableDivider(line: string) {
  return /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}

function splitTableRow(row: string) {
  return row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((value) => value.trim());
}

function startsBlock(line: string) {
  const t = line.trim();
  return /^#{1,3}\s/.test(t) || /^[-*•]\s/.test(t) || /^\d+[.)]\s/.test(t) || /^>\s/.test(t) || t.startsWith('```');
}

export default function RichAnswer({ text }: { text: string }) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
  const nodes: React.ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();
    if (!line) { i++; continue; }

    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      nodes.push(<h3 key={i} className="mb-2 mt-5 border-b border-slate-100 pb-2 text-[15px] font-black text-slate-900 first:mt-0">
        {inlineMarkdown(heading[2])}
      </h3>);
      i++;
      continue;
    }

    if (line.includes('|') && i + 1 < lines.length && isTableDivider(lines[i + 1])) {
      const header = splitTableRow(line);
      const tableRows: string[][] = [];
      const start = i;
      i += 2;
      while (i < lines.length && lines[i].trim().includes('|') && lines[i].trim()) {
        tableRows.push(splitTableRow(lines[i]));
        i++;
      }
      nodes.push(
        <div key={start} className="my-4 overflow-x-auto rounded-xl border border-slate-200">
          <table className="min-w-full border-collapse text-left text-[13px] leading-relaxed">
            <thead className="bg-slate-900 text-white"><tr>{header.map((value, c) =>
              <th key={c} className="whitespace-normal border-r border-slate-700 px-3.5 py-3 text-[12px] font-extrabold last:border-0">{value}</th>
            )}</tr></thead>
            <tbody>{tableRows.map((cells, r) =>
              <tr key={r} className="border-t border-slate-200 even:bg-slate-50">
                {header.map((_, c) => <td key={c} className="min-w-[110px] border-r border-slate-100 px-3.5 py-3 align-top last:border-r-0">{inlineMarkdown(cells[c] || '—')}</td>)}
              </tr>
            )}</tbody>
          </table>
        </div>
      );
      continue;
    }

    if (/^[-*•]\s/.test(line) || /^\d+[.)]\s/.test(line)) {
      const ordered = /^\d+[.)]\s/.test(line);
      const entries: Array<{ content: string; indent: number }> = [];
      const start = i;
      while (i < lines.length && (/^\s*[-*•]\s/.test(lines[i]) || /^\s*\d+[.)]\s/.test(lines[i]))) {
        const original = lines[i];
        entries.push({ content: original.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').trim(), indent: (original.match(/^\s*/) || [''])[0].length });
        i++;
      }
      const tagClasses = 'my-3 space-y-2 pl-5 text-[14px] leading-7 text-slate-700 marker:font-black marker:text-orange-600';
      const listItems = entries.map((entry, j) => <li key={j} style={{ marginLeft: Math.min(entry.indent, 12) * 4 }} className="pl-1.5">{inlineMarkdown(entry.content)}</li>);
      nodes.push(ordered ? <ol key={start} className={`${tagClasses} list-decimal`}>{listItems}</ol> : <ul key={start} className={`${tagClasses} list-disc`}>{listItems}</ul>);
      continue;
    }

    if (/^>\s/.test(line)) {
      const quote = line.replace(/^>\s*/, '');
      nodes.push(<blockquote key={i} className="my-3 border-l-4 border-orange-400 bg-orange-50/60 px-4 py-3 text-[14px] italic text-slate-700">{inlineMarkdown(quote)}</blockquote>);
      i++;
      continue;
    }

    if (line.startsWith('```')) {
      const code: string[] = [];
      const start = i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) code.push(lines[i++]);
      if (i < lines.length) i++;
      nodes.push(<pre key={start} className="my-3 overflow-auto rounded-lg bg-slate-900 p-4 text-[12px] text-slate-100"><code>{code.join('\n')}</code></pre>);
      continue;
    }

    const paragraph: string[] = [line];
    const start = i++;
    while (i < lines.length && lines[i].trim() && !startsBlock(lines[i]) && !(lines[i].includes('|') && i + 1 < lines.length && isTableDivider(lines[i + 1]))) {
      paragraph.push(lines[i++].trim());
    }
    nodes.push(<p key={start} className="mb-3 text-[14px] leading-[1.85] text-slate-700 last:mb-0">{inlineMarkdown(paragraph.join(' '))}</p>);
  }
  return <div className="max-w-none break-words">{nodes}</div>;
}

