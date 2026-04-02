import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { UsersService } from './users.service';

describe('UsersService availability', () => {
  const mockUserModel = {
    findById: jest.fn(),
    findByIdAndUpdate: jest.fn(),
  } as any;

  const mockOrderModel = {} as any;

  const service = new UsersService(mockUserModel, mockOrderModel);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('allows staff to update own availability', async () => {
    mockUserModel.findById.mockReturnValue({
      select: jest.fn().mockResolvedValue({ roles: ['STAFF'] }),
    });

    const updatedUser = {
      id: 'staff-1',
      email: 'staff@example.com',
      roles: ['STAFF'],
      status: 'active',
      availabilityStatus: 'AVAILABLE',
      toJSON: jest.fn().mockReturnValue({
        id: 'staff-1',
        email: 'staff@example.com',
        roles: ['STAFF'],
        status: 'active',
        availabilityStatus: 'AVAILABLE',
      }),
    };

    mockUserModel.findByIdAndUpdate.mockResolvedValue(updatedUser);

    const result = await service.updateOwnAvailability('staff-1', 'AVAILABLE');

    expect(mockUserModel.findByIdAndUpdate).toHaveBeenCalledWith(
      'staff-1',
      { availabilityStatus: 'AVAILABLE' },
      { new: true },
    );
    expect(result.availabilityStatus).toBe('AVAILABLE');
    expect(result.role).toBe('staff');
  });

  it('rejects availability update for non-staff users', async () => {
    mockUserModel.findById.mockReturnValue({
      select: jest.fn().mockResolvedValue({ roles: ['CUSTOMER'] }),
    });

    await expect(
      service.updateOwnAvailability('user-1', 'AVAILABLE'),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(mockUserModel.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  it('throws when user does not exist', async () => {
    mockUserModel.findById.mockReturnValue({
      select: jest.fn().mockResolvedValue(null),
    });

    await expect(
      service.updateOwnAvailability('missing', 'UNAVAILABLE'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
