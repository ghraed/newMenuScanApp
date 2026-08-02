export function createUuid(): string {
  let seed = Date.now();

  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, char => {
    const random = Math.floor((seed + Math.random() * 16) % 16);
    seed = Math.floor(seed / 16);
    const value = char === 'x' ? random : (random % 4) + 8;
    return value.toString(16);
  });
}
