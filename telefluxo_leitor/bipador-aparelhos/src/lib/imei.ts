export function onlyDigits(value: string) {
  return value.replace(/\D/g, "");
}

export function isValidImei(value: string) {
  const imei = onlyDigits(value);
  if (!/^\d{15}$/.test(imei)) return false;

  let sum = 0;
  for (let index = 0; index < imei.length; index += 1) {
    let digit = Number(imei[index]);
    if (index % 2 === 1) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }

  return sum % 10 === 0;
}

function scientificNotationToDigits(text: string) {
  if (!/^\s*\d+(?:[.,]\d+)?e[+-]?\d+\s*$/i.test(text)) return "";
  const numeric = Number(text.replace(",", "."));
  if (!Number.isFinite(numeric) || !Number.isSafeInteger(numeric)) return "";
  const value = numeric.toFixed(0);
  return /^\d{15}$/.test(value) ? value : "";
}

export function extractImeis(value: unknown) {
  const text = String(value ?? "").trim();
  if (!text) return [];

  const candidates = new Set<string>();
  const scientific = scientificNotationToDigits(text);
  if (scientific) candidates.add(scientific);

  const digits = onlyDigits(text);
  if (digits.length === 15) candidates.add(digits);

  for (const match of text.matchAll(/(?:^|\D)(\d{15})(?=\D|$)/g)) {
    if (match[1]) candidates.add(match[1]);
  }

  // Alguns leitores Code 128/GS1 devolvem o IMEI junto de outros identificadores,
  // formando uma sequência numérica maior. Nessa situação tentamos localizar uma
  // janela de 15 dígitos que passe pela validação de IMEI.
  for (const group of text.match(/\d{16,}/g) ?? []) {
    for (let index = 0; index <= group.length - 15; index += 1) {
      const candidate = group.slice(index, index + 15);
      if (isValidImei(candidate)) candidates.add(candidate);
    }
  }

  return [...candidates];
}

export function normalizeImei(value: string) {
  const candidates = extractImeis(value);
  if (candidates.length === 0) return "";
  return candidates.find(isValidImei) ?? candidates[0];
}

export function appendImeiCheckDigit(prefix: string) {
  const clean = onlyDigits(prefix).slice(0, 14).padEnd(14, "0");
  for (let digit = 0; digit <= 9; digit += 1) {
    const candidate = `${clean}${digit}`;
    if (isValidImei(candidate)) return candidate;
  }
  return `${clean}0`;
}
