import { fail, integer } from '../support.js';
import { difficultyMax, drawDifficulty } from './difficulty.js';

export const aiBanks = [
  { code: 0, id: 'computer-science', name: '計算機系統', prompt: 'computer-science.md', description: '硬體、資料表示、作業系統與運算原理' },
  { code: 1, id: 'internet-introduction', name: '網際網路與通訊', prompt: 'internet-introduction.md', description: '連線、網路服務、通訊與故障排除' },
  { code: 2, id: 'network-security', name: '資訊安全', prompt: 'network-security.md', description: '帳號防護、應用安全、威脅與事故回應' },
  { code: 3, id: 'information-ethics', name: '數位素養與資訊倫理', prompt: 'information-ethics.md', description: '資訊查證、著作授權、隱私與數位責任' },
  { code: 4, id: 'office-applications', name: '辦公軟體應用', prompt: 'office-applications.md', description: '文書處理、試算分析、簡報與協作' },
  { code: 5, id: 'programming', name: '程式設計', prompt: 'programming-questions.md', description: '指令邏輯、除錯、資料結構與演算法' },
  { code: 6, id: 'project-management', name: '專案管理', prompt: 'project-management.md', description: '範疇、時程、成本、風險與團隊協作' },
  { code: 7, id: 'ai-applications', name: '人工智慧應用', prompt: 'ai-applications.md', description: '提示設計、資料處理、評估與應用風險' },
];
export const aiAmounts = [10, 25, 50];
export const aiDifficultyMax = difficultyMax;
// Codes are explicit and stable even if the display order is changed.
export const bankForCode = code => aiBanks.find(bank => bank.code === code);

export function aiSettings(amount, selected) {
  amount = integer(amount);
  if (!aiAmounts.includes(amount) || !Array.isArray(selected) || !selected.length || selected.length > aiBanks.length ||
      selected.some(id => !aiBanks.some(bank => bank.id === id))) fail(422, '請選擇有效的 AI 題庫與題數（至少 10 題）。');
  return { amount, banks: aiBanks.filter(bank => selected.includes(bank.id)).map(bank => bank.id) };
}
export function planQuestions(amount, selected, random = Math.random) {
  const settings = aiSettings(amount, selected);
  // Plan the whole paper first: every selected bank appears, independently of star draws.
  const plan = Array.from({ length: settings.amount }, (_, index) => ({
    bank: settings.banks[index % settings.banks.length], difficulty: drawDifficulty(random),
  }));
  return Array.from({ length: settings.amount / 5 }, (_, batch) => plan.slice(batch * 5, batch * 5 + 5));
}
