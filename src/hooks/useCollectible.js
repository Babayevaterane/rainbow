import { useMemo } from 'react';
import { useSelector } from 'react-redux';

export default function useCollectible(asset) {
  const uniqueTokens = useSelector(
    ({ uniqueTokens: { uniqueTokens } }) => uniqueTokens
  );

  return useMemo(() => {
    let matched = uniqueTokens.find(i => i?.uniqueId === asset?.uniqueId);

    return matched || asset;
  }, [asset, uniqueTokens]);
}
