import { ShipmentsService } from './shipments.service';

describe('ShipmentsService staff filtering', () => {
  const mockShipmentModel = {} as any;
  const mockOrderModel = {} as any;
  const mockUserModel = {
    find: jest.fn(),
  } as any;
  const mockConnection = {} as any;

  const service = new ShipmentsService(
    mockShipmentModel,
    mockOrderModel,
    mockUserModel,
    mockConnection,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns only active + available staff by default', async () => {
    const rows = [{ toJSON: () => ({ id: 's1', name: 'Staff', availabilityStatus: 'AVAILABLE' }) }];

    const sort = jest.fn().mockResolvedValue(rows);
    const select = jest.fn().mockReturnValue({ sort });
    mockUserModel.find.mockReturnValue({ select });

    const result = await service.getStaffUsers();

    expect(mockUserModel.find).toHaveBeenCalledWith({
      roles: 'STAFF',
      status: 'active',
      availabilityStatus: 'AVAILABLE',
    });
    expect(result).toHaveLength(1);
    expect(result[0].availabilityStatus).toBe('AVAILABLE');
  });

  it('can include unavailable staff when flag is true', async () => {
    const rows = [{ toJSON: () => ({ id: 's1', availabilityStatus: 'UNAVAILABLE' }) }];

    const sort = jest.fn().mockResolvedValue(rows);
    const select = jest.fn().mockReturnValue({ sort });
    mockUserModel.find.mockReturnValue({ select });

    await service.getStaffUsers(true);

    expect(mockUserModel.find).toHaveBeenCalledWith({
      roles: 'STAFF',
      status: 'active',
    });
  });
});
