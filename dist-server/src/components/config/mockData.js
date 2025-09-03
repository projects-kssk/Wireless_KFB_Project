export const MOCK_KSK_NUMBER = "80%";
export const MOCK_KFB_BOARD_NAME = "IW0160029";
export const initialMockBranchItems = [
    {
        id: 'branch-1',
        branchName: 'ALPHA LINE',
        okSubStatus1: { label: "Pressure", value: "Nominal", status: 'ok' },
        okSubStatus2: { label: "Temp Ctrl", value: "Stable", status: 'ok' },
    },
    { id: 'branch-2', branchName: 'BRAVO LINE' },
    { id: 'branch-3', branchName: 'CHARLIE SYSTEM' },
    {
        id: 'branch-4',
        branchName: 'DELTA UNIT',
        okSubStatus1: { label: "Flow Rate", value: "Optimal", status: 'ok' },
        okSubStatus2: { label: "Filtration", value: "Clean", status: 'ok' },
    },
    // …and so on
];
