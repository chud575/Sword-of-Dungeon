// Run statistics sheet (F3): the current quest at a glance — score, depth, damage dealt/taken,
// potions and spells, time spent per level, plus lifetime totals from the run history.
import { el, esc, uiRoot, setModal, fmtNum } from './qolDom.js';
import { careerStats, formatTime, dailyInfo } from './save.js';

export class StatsSheet {
  /** @param {{bus:import('./events.js').EventBus, getGame:()=>any}} opts */
  constructor({ bus, getGame }) {
    this.bus = bus; this.getGame = getGame;
    this.root = null; this.modal = false;
  }

  get isOpen() { return !!this.root; }

  open() {
    const g = this.getGame();
    if (this.root || !g) return;
    const host = uiRoot(); if (!host) return;
    const s = g.getStats();
    const career = careerStats();
    const daily = dailyInfo();
    const timer = g.state.quest.timer;
    const tiles = [
      ['Score', fmtNum(s.score), '', `${esc(s.difficulty)} rules${s.daily ? ' · daily' : ''}`],
      ['Experience', fmtNum(s.xp), '', `level ${s.level} · skill ${s.skill}`],
      ['Deepest level', String(s.deepest), 'blood', s.swordFound ? (s.swordHeld ? 'carrying the Sword' : 'the Sword was found') : 'the Sword lies deeper'],
      [timer === null ? 'Quest time' : "Umla's clock", timer === null ? formatTime(s.elapsed) : formatTime(Math.max(0, timer)), timer === null ? '' : 'magic', timer === null ? `${fmtNum(s.steps)} steps · ${s.stepsPerMinute}/min` : `${formatTime(s.elapsed)} in the deep`],
    ];
    const kv = (rows) => `<div class="kv">${rows.map(([k, v]) => `<span>${esc(k)}</span><span>${esc(v)}</span>`).join('')}</div>`;
    const combat = [
      ['Monsters slain', fmtNum(s.kills)], ['Fights', `${fmtNum(s.fights)} · longest ${s.longestFight} rounds`], ['Fled or teleported out', fmtNum(s.fled)],
      ['Damage dealt', `${fmtNum(s.damageDealt)} · best hit ${s.maxHitDealt}`], ['Damage taken', `${fmtNum(s.damageTaken)} · worst hit ${s.maxHitTaken}`],
      ['Lowest hits', s.lowestHp === null ? '—' : `${s.lowestHp} / ${s.maxHp}`], ['Traps sprung', fmtNum(s.trapsSprung)], ['Wanderers heard', fmtNum(s.wanderers)],
    ];
    const loot = [
      ['Treasures opened', fmtNum(s.treasures)], ['Gold found', fmtNum(s.goldFound)], ['Gold offered', `${fmtNum(s.goldSacrificed)} in ${s.sacrifices} sacrifice${s.sacrifices === 1 ? '' : 's'}`],
      ['Gold buried', fmtNum(s.buried)], ['Potions drunk', fmtNum(s.potions)], ['Spells cast', fmtNum(s.spells)], ['Weapon enchantments', `+${s.enchant}`], ['Levels visited', fmtNum(s.levelsVisited)],
    ];
    const dt = s.depthTime.filter((d) => d.seconds >= 0.5);
    const maxT = Math.max(1, ...dt.map((d) => d.seconds));
    const bars = dt.length ? `<div class="bars">${dt.map((d) => `<span class="d">${d.depth === 0 ? 'Surface' : 'Level ' + d.depth}</span><div class="b${d.depth === s.depth ? ' now' : ''}" style="width:${Math.max(3, Math.round((d.seconds / maxT) * 100))}%"></div><span class="t">${formatTime(d.seconds)}</span>`).join('')}</div>` : '<div class="kv"><span>Nothing yet</span><span>—</span></div>';
    const html = `
      <div class="box panel">
        <div class="head"><div class="eyebrow">The tale so far</div><h1>Run Statistics</h1><div class="sub">${esc(g.playerName || 'Warrior')} · seed ${esc(String(s.seed))} · ${esc(s.difficulty)}${s.daily ? ` · daily ${esc(daily.date)}` : ''}</div></div>
        <div class="rule"></div>
        <div class="body">
          <div class="tiles">${tiles.map(([l, v, c, sub]) => `<div class="tile"><div class="l">${esc(l)}</div><div class="v ${c}">${v}</div><div class="s">${sub}</div></div>`).join('')}</div>
          <div class="cols">
            <div><h2>Battle</h2>${kv(combat)}<h2>Fortune</h2>${kv(loot)}</div>
            <div><h2>Time per level</h2>${bars}
              <div class="career"><h2>Across ${career.runs} recorded run${career.runs === 1 ? '' : 's'}</h2>${kv([
                ['Victories · deaths', `${career.victories} · ${career.deaths}`], ['Monsters slain', fmtNum(career.kills)], ['Deepest ever', career.deepest ? `level ${career.deepest}` : '—'],
                ['Best score', fmtNum(career.bestScore)], ['Time in the deep', formatTime(career.elapsed)], ['Daily seeds played', `${career.dailies}${daily.streak > 1 ? ` · streak ${daily.streak}` : ''}`],
              ])}</div>
            </div>
          </div>
          <div class="seedline">Share this dungeon: seed <b>${esc(String(s.seed))}</b> · next daily in ${formatTime(daily.nextIn)}</div>
        </div>
        <div class="foot"><span><kbd>F3</kbd>toggle</span><span><kbd>Esc</kbd>close</span></div>
      </div>`;
    const root = el('div', 'qol-sheet qol-stats', html);
    root.addEventListener('pointerdown', (e) => { if (e.target === root) this.close(); });
    host.appendChild(root);
    this.root = root;
    this.modal = setModal(true, 'stats');
    this.bus.emit('sfx:ui', { kind: 'open' });
  }

  close() {
    if (!this.root) return;
    this.root.remove(); this.root = null;
    if (this.modal) setModal(false, 'stats');
    this.modal = false;
    this.bus.emit('sfx:ui', { kind: 'close' });
  }

  toggle() { if (this.root) this.close(); else this.open(); }

  handleKey(e) {
    if (!this.root) return false;
    if (e.key === 'Escape' || e.key === 'F3' || e.key === 'Enter' || e.key === ' ' || e.key === 'Tab') this.close();
    return true;
  }
}
