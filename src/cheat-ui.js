// „Ohne Hilfen“ – gemeinsame Bedienung für alle Spiele: Hinweis-Schild, Knopf „Geschummelt!“ und
// eine kurze Meldung, ob jemand erwischt wurde oder es ein Fehlalarm war. Texte nur per textContent.
import './cheat-ui.css';

// hint = Bedienhinweis des Spiels mit data-hint / data-hint-free – wird passend zum Modus umgeschaltet
export function createCheatUI({ onAccuse, hint = null }) {
  const badge = el('div', 'cheat-badge', 'Ohne Hilfen · Schummeln erlaubt');
  const button = el('button', 'cheat-button', 'Geschummelt!');
  button.title = 'Der letzte Zug war regelwidrig? Dann jetzt drücken – aber Vorsicht: Fehlalarm kostet.';
  const toast = el('div', 'cheat-toast');
  for (const node of [badge, button, toast]) node.hidden = true;
  document.body.append(badge, button, toast);
  button.onclick = () => onAccuse();
  let timer = null;
  let lastKey = null;

  return {
    // free: Modus ohne Hilfen · canAccuse: der andere hat zuletzt gezogen und ich darf jetzt rufen
    update({ free, canAccuse }) {
      badge.hidden = !free;
      if (hint) hint.textContent = free ? hint.dataset.hintFree : hint.dataset.hint;
      button.hidden = !free || !canAccuse;
    },
    // Meldung einmal zeigen; key verhindert, dass dieselbe Meldung bei jedem Neuzeichnen wiederkommt
    say(key, text, caught) {
      if (key === lastKey) return;
      lastKey = key;
      toast.textContent = text;
      toast.className = `cheat-toast ${caught ? 'caught' : 'alarm'}`;
      toast.hidden = false;
      clearTimeout(timer);
      timer = setTimeout(() => (toast.hidden = true), 4500);
    },
    remove() {
      clearTimeout(timer);
      badge.remove();
      button.remove();
      toast.remove();
    },
  };
}

function el(tag, className, text = '') {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}
