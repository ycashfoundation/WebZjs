import TransactionHistoryComponent from '../../components/TransactionHistory/TransactionHistory';
import PageHeading from '../../components/PageHeading/PageHeading';

function TransactionHistoryPage() {
  return (
    <div className="w-full pb-16">
      <PageHeading title="Transactions" eyebrow="Signed by this wallet" />
      <TransactionHistoryComponent />
    </div>
  );
}

export default TransactionHistoryPage;
