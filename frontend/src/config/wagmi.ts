import { createConfig, createStorage, http } from 'wagmi';
import { injected } from 'wagmi/connectors';
import { sepolia } from 'wagmi/chains';

const memoryStorage = {
  getItem(_key: string) {
    return null;
  },
  setItem(_key: string, _value: string) {},
  removeItem(_key: string) {},
};

export const config = createConfig({
  chains: [sepolia],
  connectors: [injected()],
  transports: {
    [sepolia.id]: http('https://rpc.sepolia.org'),
  },
  storage: createStorage({ storage: memoryStorage }),
});
