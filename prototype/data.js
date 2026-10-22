/* bnki 原型：示例数据。修改会存在浏览器 localStorage，底部条上的“重置示例数据”可恢复。 */
(function () {
  const L = (...lines) => lines.join('\n');
  const DAY = 864e5, now = Date.now();

  const folders = [
    { id: 'f1', name: '面试材料' },
    { id: 'f2', name: '语言' },
  ];

  const decks = [
    {
      id: 'd1', title: '操作系统', folderId: 'f1', description: '进程、线程、内存管理的核心概念',
      createdAt: now - 120 * DAY, updatedAt: now - 2 * DAY, openedAt: now - 3600e3, studiedAt: now - 3600e3, pinned: true,
      items: [
        { id: 's1', kind: 'section', level: 1, title: '进程与线程' },
        { id: 'c1', kind: 'card', type: 'note', color: 'default', front: L(
          '**进程与线程的区别**',
          '- 进程是 {{资源分配}} 的基本单位，线程是 {{CPU 调度}} 的基本单位',
          '- 同一进程内的线程共享 {{地址空间}} 和 {{打开的文件}}，但各自有独立的 {{栈}} 和寄存器',
          '- 进程切换要切换 {{页表}}，开销更大') },
        { id: 'c2', kind: 'card', type: 'qa', color: 'light-blue',
          front: '进程有哪几种基本状态？', hint: '三态模型：就绪 → 运行 → 阻塞',
          back: L('1. **就绪**：拿到除 CPU 以外的所有资源', '2. **运行**：占用 CPU', '3. **阻塞**：等待某个事件（I/O 完成等）', '', '> 五态模型再加上 ==新建== 和 ==终止==') },
        { id: 'c3', kind: 'card', type: 'note', color: 'light-yellow', front: L(
          '### 进程间通信（IPC）',
          '1. {{管道}}：半双工，只能在有亲缘关系的进程间使用',
          '2. {{命名管道 FIFO}}：允许无亲缘关系的进程通信',
          '3. {{消息队列}}',
          '4. {{共享内存}}：最快的 IPC，需要配合 {{信号量}} 做同步',
          '5. {{套接字}}：可跨机器') },
        { id: 'c4', kind: 'card', type: 'qa', color: 'default',
          front: '什么是死锁？产生死锁的四个必要条件？',
          back: L('多个进程因争夺资源而互相等待，若无外力作用都无法推进。', '', '四个必要条件：', '- {{互斥}}', '- {{占有并等待}}', '- {{非抢占}}', '- {{循环等待}}', '', '破坏其中任意一个即可预防死锁。') },
        { id: 's2', kind: 'section', level: 1, title: '内存管理' },
        { id: 'c5', kind: 'card', type: 'note', color: 'default', front: L(
          '虚拟内存让每个进程都以为自己独占一块 {{连续的}} 地址空间，',
          '实际由 {{MMU}} 通过 {{页表}} 把虚拟地址翻译成物理地址。',
          '',
          '为加速翻译，CPU 内有一个页表缓存叫 {{TLB}}。') },
        { id: 's3', kind: 'section', level: 2, title: '页面置换' },
        { id: 'c6', kind: 'card', type: 'qa', color: 'green', front: '常见的页面置换算法有哪些？',
          back: L('| 算法 | 思路 |', '|---|---|', '| OPT | 淘汰将来最久不用的（理论最优） |', '| FIFO | 先进先出，可能出现 Belady 异常 |', '| LRU | 淘汰最近最久未使用的 |', '| Clock | LRU 的近似，用访问位 |') },
        { id: 'c7', kind: 'card', type: 'note', color: 'default', front: L(
          'LRU 用 {{哈希表 + 双向链表}} 实现，get/put 都是 {{O(1)}}。',
          '',
          '```java',
          'class LRUCache extends LinkedHashMap<Integer, Integer> {',
          '    private final int cap;',
          '    LRUCache(int cap) { super(cap, 0.75f, true); this.cap = cap; }',
          '    @Override',
          '    protected boolean removeEldestEntry(Map.Entry<Integer, Integer> e) {',
          '        return size() > cap;',
          '    }',
          '}',
          '```') },
      ],
    },
    {
      id: 'd2', title: 'Java 并发', folderId: 'f1', description: '',
      createdAt: now - 200 * DAY, updatedAt: now - 9 * DAY, openedAt: now - 2 * DAY, studiedAt: now - 2 * DAY,
      items: [
        { id: 's21', kind: 'section', level: 1, title: '关键字' },
        { id: 'c21', kind: 'card', type: 'qa', color: 'default', front: '`volatile` 能保证什么？不能保证什么？',
          hint: '口诀：见序不原（可见、有序，不保证原子）',
          back: L('- 保证 {{可见性}}：写操作立即刷回主存，读操作从主存读', '- 保证 {{有序性}}：禁止指令重排（内存屏障）', '- **不保证** {{原子性}}：`i++` 仍然线程不安全') },
        { id: 'c22', kind: 'card', type: 'note', color: 'light-red', front: L(
          '`synchronized` 锁升级顺序：',
          '{{无锁}} → {{偏向锁}} → {{轻量级锁}} → {{重量级锁}}',
          '',
          '锁只能 ==升级不能降级==。') },
        { id: 's22', kind: 'section', level: 1, title: '线程池' },
        { id: 'c23', kind: 'card', type: 'qa', color: 'blue', front: '`ThreadPoolExecutor` 的 7 个参数？',
          back: L('```java', 'new ThreadPoolExecutor(', '    corePoolSize,     // 核心线程数', '    maximumPoolSize,  // 最大线程数', '    keepAliveTime,    // 空闲存活时间', '    unit,', '    workQueue,        // 任务队列', '    threadFactory,', '    handler           // 拒绝策略', ');', '```') },
        { id: 'c24', kind: 'card', type: 'note', color: 'default', front: L(
          '任务提交流程：',
          '1. 线程数 < {{corePoolSize}}：直接新建线程',
          '2. 否则放入 {{workQueue}}',
          '3. 队列满了且线程数 < {{maximumPoolSize}}：新建非核心线程',
          '4. 否则执行 {{拒绝策略}}') },
      ],
    },
    {
      id: 'd3', title: '计算机网络', folderId: null, description: '',
      createdAt: now - 90 * DAY, updatedAt: now - 30 * DAY, openedAt: now - 5 * DAY, studiedAt: now - 5 * DAY,
      items: [
        { id: 's31', kind: 'section', level: 1, title: '传输层' },
        { id: 'c31', kind: 'card', type: 'note', color: 'default', front: 'TCP 三次握手的第二步，服务端发送 {{SYN+ACK}}，进入 {{SYN_RCVD}} 状态。' },
        { id: 'c32', kind: 'card', type: 'qa', color: 'default', front: '为什么是三次握手而不是两次？',
          back: '防止 **已失效的连接请求** 突然又传到服务端，导致服务端误建立连接、白白浪费资源。三次握手能让双方都确认 {{自己和对方的收发能力}} 正常。' },
        { id: 'c33', kind: 'card', type: 'qa', color: 'light-green', front: 'TIME_WAIT 为什么要等 2MSL？',
          back: L('1. 保证最后一个 {{ACK}} 能到达对端（丢了对端会重传 FIN）', '2. 让本连接的旧报文在网络中 {{全部消失}}，不影响新连接') },
        { id: 'c34', kind: 'card', type: 'topic', color: 'default', front: 'HTTP/2 相比 HTTP/1.1', back: '二进制分帧、多路复用、头部压缩（HPACK）、服务端推送。仍然存在 TCP 层的队头阻塞，HTTP/3 改用 QUIC 解决。' },
      ],
    },
    {
      id: 'd4', title: '英语语法', folderId: 'f2', description: '',
      createdAt: now - 60 * DAY, updatedAt: now - 14 * DAY, openedAt: now - 10 * DAY, studiedAt: now - 10 * DAY,
      items: [
        { id: 'c41', kind: 'card', type: 'note', color: 'default', front: 'I wish I {{had known}} that earlier.（与过去事实相反的虚拟语气）' },
        { id: 'c42', kind: 'card', type: 'note', color: 'light-yellow', front: 'Not until he came back {{did I realize}} what had happened.（否定词前置 → 部分倒装）' },
        { id: 'c43', kind: 'card', type: 'qa', color: 'default', front: '*affect* 和 *effect* 的区别？', back: '- **affect**：动词，影响\n- **effect**：名词，效果；作动词时意为“实现、使发生”' },
      ],
    },
    {
      id: 'd5', title: '数学公式', folderId: null, description: '',
      createdAt: now - 20 * DAY, updatedAt: now - 20 * DAY, openedAt: null, studiedAt: null,
      items: [
        { id: 'c51', kind: 'card', type: 'note', color: 'default', front: '一元二次方程的求根公式：{{$x=\\frac{-b\\pm\\sqrt{b^2-4ac}}{2a}$}}' },
        { id: 'c52', kind: 'card', type: 'qa', color: 'default', front: '欧拉公式', back: '$$\ne^{i\\pi}+1=0\n$$' },
      ],
    },
    {
      id: 'd6', title: '空的卡片集', folderId: null, description: '',
      createdAt: now - DAY, updatedAt: now - DAY, openedAt: null, studiedAt: null, items: [],
    },
  ];

  // 记忆状态：一部分到期、一部分未来、一部分新卡
  const states = {
    c1: { state: 2, S: 6, D: 5.5, reps: 3, lapses: 0, last: now - 8 * DAY, due: now - 2 * DAY },
    c2: { state: 2, S: 15, D: 5.2, reps: 4, lapses: 0, last: now - 10 * DAY, due: now + 5 * DAY },
    c3: { state: 2, S: 3, D: 6.5, reps: 2, lapses: 1, last: now - 4 * DAY, due: now - 1 * DAY },
    c5: { state: 2, S: 30, D: 4.8, reps: 5, lapses: 0, last: now - 170 * DAY, due: now - 140 * DAY },
    c21: { state: 2, S: 4, D: 6.8, reps: 3, lapses: 1, last: now - 5 * DAY, due: now - 1 * DAY },
    c22: { state: 2, S: 20, D: 5, reps: 4, lapses: 0, last: now - 6 * DAY, due: now + 14 * DAY },
    c23: { state: 2, S: 2, D: 7, reps: 2, lapses: 1, last: now - 3 * DAY, due: now - 1 * DAY, mastered: false },
    c31: { state: 2, S: 40, D: 4, reps: 6, lapses: 0, last: now - 20 * DAY, due: now + 20 * DAY },
    c33: { state: 2, S: 10, D: 5.5, reps: 3, lapses: 0, last: now - 12 * DAY, due: now - 2 * DAY },
    c41: { state: 2, S: 50, D: 3.5, reps: 7, lapses: 0, last: now - 10 * DAY, due: now + 40 * DAY, mastered: true },
    c42: { state: 2, S: 8, D: 5, reps: 3, lapses: 0, last: now - 9 * DAY, due: now - 1 * DAY },
  };

  // 过去 120 天的复习日志（统计页用）
  const logs = [];
  let seed = 7;
  const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
  for (let d = 120; d >= 1; d--) {
    const studied = d <= 6 ? true : rnd() > 0.38;
    if (!studied) continue;
    const n = Math.floor(5 + rnd() * 45);
    for (let i = 0; i < n; i++) {
      logs.push({ at: now - d * DAY + i * 60e3, rating: rnd() < 0.12 ? 1 : rnd() < 0.2 ? 2 : 3, kind: 'grade' });
    }
  }
  const edits = [];
  for (let d = 90; d >= 1; d--) {
    if (rnd() > 0.55) continue;
    const n = Math.floor(rnd() * 14);
    for (let i = 0; i < n; i++) edits.push({ at: now - d * DAY + i * 90e3 });
  }

  const settings = {
    defaultMode: 'daily',
    newPerDay: 20,
    reviewPerDay: 100,
    clickBlankRevealNext: true,
    fontSize: 'default',
    retention: 0.9,
    maxIvl: 365,
    dayHour: 4,
    steps: 10,
    fuzz: true,
    easyButton: false,
    continuousNew: true,
    theme: 'light',
    requeueNoReschedule: true,
    dataDir: '~/bnki-data',
  };

  window.SEED = { folders, decks, states, logs, edits, settings, version: 3 };
})();
