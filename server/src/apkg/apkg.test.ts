import { describe, expect, it } from 'vitest';
import { zipSync } from 'fflate';
import { readApkg } from './read';
import { buildApkg } from './fixture';
import { ankiToMarkdown } from './markdown';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 4, 5, 6]);

describe('readApkg', () => {
  for (const format of ['legacy', 'new'] as const) {
    it(`${format}：读笔记、字段、deckPath、媒体，排序正确`, () => {
      const buf = buildApkg({
        format,
        decks: { 1: '根', 2: '根::第一章', 3: '根::第二章' },
        notes: [
          { id: 11, flds: ['字段1', '字段2'], did: 2 },
          { id: 12, flds: ['甲'], did: 1 },
          { id: 13, flds: ['x'], did: 3 },
          { id: 14, flds: ['没有卡片'], did: 2, noCard: true },
        ],
        media: { 'a.png': PNG, 'b.jpg': JPG },
      });
      const data = readApkg(buf);
      expect(data.notes.length).toBe(3); // 没有卡片的笔记丢掉
      expect(data.notes.map((n) => n.id)).toEqual([12, 11, 13]); // deckPath 字典序，同级按 id
      expect(data.notes[0].deckPath).toEqual(['根']);
      expect(data.notes[0].fields).toEqual(['甲']);
      expect(data.notes[1].deckPath).toEqual(['根', '第一章']);
      expect(data.notes[1].fields).toEqual(['字段1', '字段2']);
      expect(data.notes[2].deckPath).toEqual(['根', '第二章']);
      expect(data.media.size).toBe(2);
      expect(Buffer.compare(data.media.get('a.png')!, PNG)).toBe(0);
      expect(Buffer.compare(data.media.get('b.jpg')!, JPG)).toBe(0);
    });
  }

  it('非 zip 内容抛错', () => {
    expect(() => readApkg(Buffer.from('这不可能是 zip'))).toThrow('不是有效的 .apkg 文件');
  });

  it('zip 里没有集合数据库抛错', () => {
    const zip = Buffer.from(zipSync({ 'readme.txt': Buffer.from('hi') }));
    expect(() => readApkg(zip)).toThrow('不是有效的 .apkg 文件');
  });
});

describe('ankiToMarkdown', () => {
  const map = new Map([['a.png', 'media/h.png']]);
  const md = (html: string) => ankiToMarkdown(html, map);

  it('挖空去掉编号和提示', () => {
    expect(md('{{c1::内容}}')).toBe('{{内容}}');
    expect(md('{{c2::内容::提示}}')).toBe('{{内容}}');
  });

  it('粗斜体等行内样式', () => {
    expect(md('<b>粗</b><strong>粗</strong>')).toBe('**粗****粗**');
    expect(md('<i>斜</i><em>斜</em>')).toBe('*斜**斜*');
    expect(md('<u>下划线</u>')).toBe('<u>下划线</u>');
    expect(md('<s>删</s><strike>删</strike><del>删</del>')).toBe('~~删~~~~删~~~~删~~');
  });

  it('换行：br / div / p，连续 3 个以上压成 2 个', () => {
    expect(md('a<br>b')).toBe('a\nb');
    expect(md('<div>a</div><div>b</div>')).toBe('a\nb');
    expect(md('<p>a</p><p>b</p>')).toBe('a\nb');
    expect(md('a<br><br><br>b')).toBe('a\n\nb');
  });

  it('列表：ul 用 -，ol 用数字', () => {
    expect(md('<ul><li>a</li><li>b</li></ul>')).toBe('- a\n- b');
    expect(md('<ol><li>a</li><li>b</li></ol>')).toBe('1. a\n2. b');
  });

  it('图片：有映射换名，没映射丢掉', () => {
    expect(md('<img src="a.png">')).toBe('![](media/h.png)');
    expect(md('<img src="miss.png">字')).toBe('字');
  });

  it('去掉 [sound:...] 标记', () => {
    expect(md('前[sound:x.mp3]后')).toBe('前后');
  });

  it('公式', () => {
    expect(md('质量 \\(m\\) 很大')).toBe('质量 $m$ 很大');
    expect(md('\\[E=mc^2\\]')).toBe('$$E=mc^2$$');
  });

  it('实体解码', () => {
    expect(md('a&nbsp;&lt;&gt;&amp;&quot;&#39;&#65;')).toBe('a <>&"\'A');
  });

  it('其他标签只去标签', () => {
    expect(md('<span>甲</span><font size="1">乙</font><a href="#">丙</a>')).toBe('甲乙丙');
  });

  it('组合用例', () => {
    expect(md('<div><b>{{c1::进程}}</b>是资源分配的单位</div><div>见&nbsp;<img src="a.png"></div>'))
      .toBe('**{{进程}}**是资源分配的单位\n见 ![](media/h.png)');
  });
});

describe('ankiToMarkdown 补充', () => {
  it('图片名做过 URL / 实体编码也能对上；十六进制实体', () => {
    const map = new Map([['my pic.png', 'media/p.png'], ['a&b.png', 'media/q.png']]);
    expect(ankiToMarkdown('<img src="my%20pic.png"><img src="a&amp;b.png"> &#x4e2d;&apos;', map)).toBe('![](media/p.png)![](media/q.png) 中\'');
  });
});
