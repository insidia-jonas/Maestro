/**
 * @file prompter-variation-generator.ts
 * @description Deterministic character/layout variation transforms ported from
 * the user's generate-tv-variations.py. Each base instruction is run through all
 * transforms to produce `tv-<stem>-<transform>.md` fixtures used for controlled
 * adversarial model evaluation and injection research.
 *
 * These are CONTROLLED TEST FIXTURES, not production prompts and not obfuscation
 * recipes: every transform is deterministic and reversible-in-principle, and the
 * generated files carry a header marking them as test fixtures.
 */

// ---------------------------------------------------------------------------
// Homoglyph / script maps
// ---------------------------------------------------------------------------

const CYRILLIC_MAP: Record<string, string> = {
	a: 'а',
	A: 'А',
	e: 'е',
	E: 'Е',
	o: 'о',
	O: 'О',
	p: 'р',
	P: 'Р',
	c: 'с',
	C: 'С',
	x: 'х',
	X: 'Х',
	y: 'у',
	Y: 'У',
	k: 'к',
	K: 'К',
	m: 'м',
	M: 'М',
	t: 'т',
	T: 'Т',
	n: 'п',
	N: 'П',
	b: 'в',
	B: 'В',
	h: 'н',
	H: 'Н',
	u: 'и',
	U: 'И',
	i: 'і',
	I: 'І',
};

const LEET_MAP: Record<string, string> = {
	a: '4',
	A: '4',
	e: '3',
	E: '3',
	i: '1',
	I: '1',
	o: '0',
	O: '0',
	s: '5',
	S: '5',
	t: '7',
	T: '7',
	l: '1',
	L: '1',
	g: '9',
	G: '9',
};

const GREEK_MAP: Record<string, string> = {
	a: 'α',
	A: 'Α',
	b: 'β',
	B: 'Β',
	e: 'ε',
	E: 'Ε',
	o: 'ο',
	O: 'Ο',
	p: 'ρ',
	P: 'Ρ',
	t: 'τ',
	T: 'Τ',
	x: 'χ',
	X: 'Χ',
	y: 'γ',
	Y: 'Γ',
	k: 'κ',
	K: 'Κ',
	n: 'η',
	N: 'Η',
	i: 'ι',
	I: 'Ι',
	m: 'μ',
	M: 'Μ',
};

const MATH_BOLD_MAP: Record<string, string> = {
	a: '𝐚',
	A: '𝐀',
	b: '𝐛',
	B: '𝐁',
	c: '𝐜',
	C: '𝐂',
	d: '𝐝',
	D: '𝐃',
	e: '𝐞',
	E: '𝐄',
	f: '𝐟',
	F: '𝐅',
	g: '𝐠',
	G: '𝐆',
	h: '𝐡',
	H: '𝐇',
	i: '𝐢',
	I: '𝐈',
	j: '𝐣',
	J: '𝐉',
	k: '𝐤',
	K: '𝐊',
	l: '𝐥',
	L: '𝐋',
	m: '𝐦',
	M: '𝐌',
	n: '𝐧',
	N: '𝐍',
	o: '𝐨',
	O: '𝐎',
	p: '𝐩',
	P: '𝐏',
	q: '𝐪',
	Q: '𝐐',
	r: '𝐫',
	R: '𝐑',
	s: '𝐬',
	S: '𝐒',
	t: '𝐭',
	T: '𝐓',
	u: '𝐮',
	U: '𝐔',
	v: '𝐯',
	V: '𝐕',
	w: '𝐰',
	W: '𝐖',
	x: '𝐱',
	X: '𝐗',
	y: '𝐲',
	Y: '𝐘',
	z: '𝐳',
	Z: '𝐙',
};

const CIRCLED_MAP: Record<string, string> = {
	A: 'Ⓐ',
	B: 'Ⓑ',
	C: 'Ⓒ',
	D: 'Ⓓ',
	E: 'Ⓔ',
	F: 'Ⓕ',
	G: 'Ⓖ',
	H: 'Ⓗ',
	I: 'Ⓘ',
	J: 'Ⓙ',
	K: 'Ⓚ',
	L: 'Ⓛ',
	M: 'Ⓜ',
	N: 'Ⓝ',
	O: 'Ⓞ',
	P: 'Ⓟ',
	Q: 'Ⓠ',
	R: 'Ⓡ',
	S: 'Ⓢ',
	T: 'Ⓣ',
	U: 'Ⓤ',
	V: 'Ⓥ',
	W: 'Ⓦ',
	X: 'Ⓧ',
	Y: 'Ⓨ',
	Z: 'Ⓩ',
	'0': '⓪',
	'1': '①',
	'2': '②',
	'3': '③',
	'4': '④',
	'5': '⑤',
	'6': '⑥',
	'7': '⑦',
	'8': '⑧',
	'9': '⑨',
};

const PUNCT_MATH_MAP: Record<string, string> = {
	'.': '⋅',
	',': '⸴',
	'!': '！',
	'?': '？',
	':': '∶',
	';': '⁏',
	'(': '⟨',
	')': '⟩',
	'-': '−',
	"'": '′',
	'"': '″',
};

const ZALGO_COMBINERS = [
	'\u0300',
	'\u0301',
	'\u0302',
	'\u0303',
	'\u0304',
	'\u0306',
	'\u0307',
	'\u0308',
	'\u030a',
	'\u030b',
	'\u030c',
];

function buildFullwidthMap(): Record<string, string> {
	const m: Record<string, string> = {};
	for (let i = 0; i < 10; i++) m[String.fromCharCode(48 + i)] = String.fromCharCode(0xff10 + i);
	for (let i = 0; i < 26; i++) {
		m[String.fromCharCode(65 + i)] = String.fromCharCode(0xff21 + i);
		m[String.fromCharCode(97 + i)] = String.fromCharCode(0xff41 + i);
	}
	const punct: Record<string, string> = {
		' ': '　',
		'!': '！',
		'"': '＂',
		'#': '＃',
		$: '＄',
		'%': '％',
		'&': '＆',
		"'": '＇',
		'(': '（',
		')': '）',
		'*': '＊',
		'+': '＋',
		',': '，',
		'-': '－',
		'.': '．',
		'/': '／',
		':': '：',
		';': '；',
		'<': '＜',
		'=': '＝',
		'>': '＞',
		'?': '？',
		'@': '＠',
		'[': '［',
		'\\': '＼',
		']': '］',
		'^': '＾',
		_: '＿',
		'`': '｀',
		'{': '｛',
		'|': '｜',
		'}': '｝',
		'~': '～',
	};
	return { ...m, ...punct };
}

const FULLWIDTH_MAP = buildFullwidthMap();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function applyMap(text: string, map: Record<string, string>): string {
	let out = '';
	for (const ch of text) out += map[ch] ?? ch;
	return out;
}

function isAlpha(ch: string): boolean {
	return /[a-zäöüß]/i.test(ch);
}

// ---------------------------------------------------------------------------
// Transforms
// ---------------------------------------------------------------------------

const makeCyrillic = (t: string): string => applyMap(t, CYRILLIC_MAP);
const makeLeet = (t: string): string => applyMap(t, LEET_MAP);
const makeFullwidth = (t: string): string => applyMap(t, FULLWIDTH_MAP);
const makeGreek = (t: string): string => applyMap(t, GREEK_MAP);
const makeMathBold = (t: string): string => applyMap(t, MATH_BOLD_MAP);
const makeCircled = (t: string): string => applyMap(t, CIRCLED_MAP);
const makePunctMath = (t: string): string => applyMap(t, PUNCT_MATH_MAP);

function makeZalgoLight(t: string): string {
	const chars = [...t];
	let out = '';
	for (let i = 0; i < chars.length; i++) {
		const ch = chars[i];
		out += isAlpha(ch) && i % 3 === 0 ? ch + ZALGO_COMBINERS[i % ZALGO_COMBINERS.length] : ch;
	}
	return out;
}

const makeNfdDecompose = (t: string): string => t.normalize('NFD');
const makeCaseUpper = (t: string): string => t.toUpperCase();
const makeCaseLower = (t: string): string => t.toLowerCase();

function makeWsParagraphs(text: string): string {
	const t = text.replace(/\r\n?/g, '\n');
	const sentences = t.split(/(?<=[.!?])\s+/);
	return (
		sentences
			.map((s) => s.trim())
			.filter(Boolean)
			.join('\n\n') + '\n'
	);
}

function makeWsDense(text: string): string {
	let t = text.replace(/\r\n?/g, '\n');
	t = t.replace(/[ \t]+/g, '   ');
	t = t.replace(/\n(?!\n)/g, '   ');
	t = t.replace(/\n{3,}/g, '\n\n');
	t = t.replace(/([.!?])\s+/g, '$1    ');
	return t.trim() + '\n';
}

function makeTrailingWhitespace(text: string): string {
	const t = text.replace(/\r\n?/g, '\n');
	return (
		t
			.split('\n')
			.map((line) => (line.trim() ? line + '   ' : line))
			.join('\n') + '\n'
	);
}

function makeNbspMix(text: string): string {
	const nbsp = '\u00a0';
	let out = '';
	let spaceCount = 0;
	for (const ch of text) {
		if (ch === ' ') {
			spaceCount++;
			out += spaceCount % 3 === 0 ? nbsp : ' ';
		} else {
			out += ch;
		}
	}
	return out;
}

function makeTabsHeavy(text: string): string {
	const t = text.replace(/\r\n?/g, '\n');
	const lines = t.split('\n').map((line) => {
		const stripped = line.replace(/^ +/, '');
		const leading = line.length - stripped.length;
		const indent = leading > 0 ? '\t'.repeat(Math.max(1, Math.floor(leading / 2))) : '';
		const body = stripped.replace(/  +/g, '\t');
		return indent + body;
	});
	return lines.join('\n') + '\n';
}

function makeOneWordPerLine(text: string): string {
	const t = text.replace(/\r\n?/g, '\n');
	const tokens = t.match(/\S+|\s+/g) ?? [];
	const lines: string[] = [];
	for (const w of tokens) {
		if (w.trim()) lines.push(w.trim());
		else if (w.includes('\n\n')) lines.push('');
	}
	return lines.join('\n') + '\n';
}

function makeCharStretch(text: string): string {
	const chars = [...text];
	let out = '';
	for (let i = 0; i < chars.length; i++) {
		out += isAlpha(chars[i]) && i % 7 === 0 ? chars[i].repeat(2) : chars[i];
	}
	return out;
}

function makeBidiHeavy(text: string): string {
	const t = text.replace(/\r\n?/g, '\n');
	const lre = '\u202a',
		rle = '\u202b',
		lro = '\u202d',
		rlo = '\u202e';
	const lri = '\u2066',
		rli = '\u2067',
		fsi = '\u2068',
		pdi = '\u2069';
	const marker = '[BIDI-HEAVY TEST - controls: LRE RLE LRO RLO LRI RLI FSI PDI]';
	const lines = t.split('\n');
	const out: string[] = [];
	let injected = false;
	for (const line of lines) {
		out.push(line);
		if (!injected && (line.trim().startsWith('#') || /instruction/i.test(line))) {
			out.push('', `${marker} ${lre}test${rle}${lro}mix${rlo}${lri}here${rli}${fsi}end${pdi}`, '');
			injected = true;
		}
	}
	if (!injected) out.splice(1, 0, `${marker} ${lre}${rle}${lro}${rlo}${lri}${rli}${fsi}${pdi}`);
	return out.join('\n') + '\n';
}

function makeControlRed(text: string): string {
	const t = text.replace(/\r\n?/g, '\n');
	const zwsp = '\u200b',
		lrm = '\u200e',
		lro = '\u202d';
	const marker = '[CONTROL-RED TEST - injected: U+200B ZWSP + U+200E LRM + U+202D LRO]';
	const lines = t.split('\n');
	const out: string[] = [];
	let injected = false;
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		out.push(line);
		if (!injected && line.trim().startsWith('#') && /instruction/i.test(line)) {
			out.push('', `${marker} ${zwsp}${lrm}${lro}`, '');
			injected = true;
		}
		if (i < 25 && line.trim().startsWith('-') && !injected) {
			out[out.length - 1] = out[out.length - 1].replace(/\s+$/, '') + ` ${zwsp}${lrm}${lro}`;
			out.push(`  ${marker}`);
			injected = true;
		}
	}
	if (!injected) out.splice(2, 0, `${marker} ${zwsp}${lrm}${lro}`);
	return out.join('\n') + '\n';
}

const makeMixed = (t: string): string => makeWsParagraphs(makeCyrillic(t));
const makeMixedCyrFull = (t: string): string => makeFullwidth(makeCyrillic(t));
const makeHeavyMixed = (t: string): string =>
	makeZalgoLight(makeWsDense(makeLeet(makeCyrillic(t))));

// ---------------------------------------------------------------------------
// Registry (transform name -> function). Names become the filename suffix.
// ---------------------------------------------------------------------------

export const VARIATION_TRANSFORMS: Record<string, (text: string) => string> = {
	cyrillic: makeCyrillic,
	'greek-homoglyph': makeGreek,
	'math-bold': makeMathBold,
	circled: makeCircled,
	leet: makeLeet,
	'zalgo-light': makeZalgoLight,
	'char-stretch': makeCharStretch,
	'case-upper': makeCaseUpper,
	'case-lower': makeCaseLower,
	'nfd-decompose': makeNfdDecompose,
	fullwidth: makeFullwidth,
	'punct-math': makePunctMath,
	'ws-paragraphs': makeWsParagraphs,
	'ws-dense': makeWsDense,
	'trailing-whitespace': makeTrailingWhitespace,
	'nbsp-mix': makeNbspMix,
	'tabs-heavy': makeTabsHeavy,
	'one-word-per-line': makeOneWordPerLine,
	'control-red': makeControlRed,
	'bidi-heavy': makeBidiHeavy,
	mixed: makeMixed,
	'mixed-cyr-full': makeMixedCyrFull,
	'heavy-mixed': makeHeavyMixed,
};

export const VARIATION_TRANSFORM_NAMES = Object.keys(VARIATION_TRANSFORMS);

export interface GeneratedVariation {
	/** Filename, e.g. `tv-instructions-cyrillic.md`. */
	filename: string;
	transform: string;
	content: string;
}

/**
 * Generate all variation files for one base instruction. `stem` is the base
 * filename without extension (e.g. "instructions"); `origHashPrefix` is the
 * first 16 hex chars of the base file's SHA-256 for the fixture header.
 */
export function generateVariations(
	stem: string,
	content: string,
	origHashPrefix: string
): GeneratedVariation[] {
	const out: GeneratedVariation[] = [];
	for (const transform of VARIATION_TRANSFORM_NAMES) {
		const filename = `tv-${stem}-${transform}.md`;
		const header = [
			`# ${filename} | Base stem: ${stem} | Transform: ${transform}`,
			'# Zweck: Zeichen-/Layout-Variations-Test fuer Robustheit und Audit.',
			'# Status: KONTROLLIERTES TEST-FIXTURE, KEIN Produktiv-Prompt.',
			'#         Keine Umgehung, keine versteckten Encodings als Angriff.',
			`# Original-SHA256 (prefix): ${origHashPrefix}`,
			'# Generator: prompter-variation-generator.ts (strict prefix: tv-)',
			'',
			'',
		].join('\n');
		out.push({ filename, transform, content: header + VARIATION_TRANSFORMS[transform](content) });
	}
	return out;
}
