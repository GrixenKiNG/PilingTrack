import PreviousOrionPage, { metadata as previousMetadata } from '../page';

export const metadata = {
  ...previousMetadata,
  robots: { index: false, follow: false },
  alternates: { canonical: '/orion/previous' },
};

export default PreviousOrionPage;
