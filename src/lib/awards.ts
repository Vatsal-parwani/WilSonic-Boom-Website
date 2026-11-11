import awardsData from '../data/awards.json';

export interface Award {
  id: string;
  name: string;
  category: string;
  image?: string;
  description: string;
  priority: string;
  criteria: string[];
  teamStrategy: string;
}

export function getAwards(): Award[] {
  return awardsData as Award[];
}

export function getCategories(): string[] {
  const awards = getAwards();
  const categories = new Set(awards.map((a) => a.category));
  return Array.from(categories);
}