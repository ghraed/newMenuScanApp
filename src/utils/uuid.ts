export function createUuid(): string {
  let seed = Date.now();

  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, char => {
    const random = (seed + Math.random() * 16) % 16 | 0;
    seed = Math.floor(seed / 16);
    const value = char === 'x' ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}
